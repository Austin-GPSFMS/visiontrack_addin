/**
 * Pairing tool for the Device Association page.
 *
 * Lets a rule-manager / admin pick a Geotab unit (search by name, VIN, or
 * serial) and a VisionTrack camera (search by serial / hardware ID), choose a
 * fuel type, and pair them. Pairing stamps the camera's VT vehicle with the
 * Geotab description (vrn) and VIN — so the display name stops drifting to the
 * UK license plate — auto-filling the other VT-required fields. A background
 * worker then keeps the name in sync with Geotab going forward.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  GeotabSession,
  PairCamera,
  PairGeotabUnit,
  PairOptionsResponse,
} from "../types";
import { fetchPairOptions, runPair } from "../api/proxy";
import { friendlyError } from "../api/geotab";

// Common fuel types — free-text on the VT side, so a fixed list keeps it tidy.
const FUEL_TYPES = [
  "Diesel",
  "Gasoline",
  "Petrol",
  "Electric",
  "Hybrid",
  "LPG",
  "CNG",
  "Other",
];

/** Tiny searchable single-select reusing the dashboard's .vt-vehsel styles. */
function SearchSelect<T>({
  items,
  value,
  onChange,
  getKey,
  getLabel,
  getSub,
  match,
  placeholder,
  searchPlaceholder,
}: {
  items: T[];
  value: string | null;
  onChange: (key: string | null) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSub?: (item: T) => string | undefined;
  match: (item: T, q: string) => boolean;
  placeholder: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = items.find((i) => getKey(i) === value) ?? null;
  const query = q.trim().toLowerCase();
  const matches = (query ? items.filter((i) => match(i, query)) : items).slice(0, 60);

  return (
    <div className="vt-vehsel" ref={rootRef}>
      <button type="button" className="vt-vehsel-trigger" onClick={() => setOpen((o) => !o)}>
        <span className={selected ? "" : "vt-muted"}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <span className="vt-vehsel-caret">▾</span>
      </button>
      {open && (
        <div className="vt-vehsel-menu">
          <input
            className="vt-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
          />
          <div className="vt-vehsel-list">
            {matches.map((i) => {
              const key = getKey(i);
              const sub = getSub?.(i);
              return (
                <button
                  key={key}
                  type="button"
                  className={`vt-vehsel-item${value === key ? " vt-vehsel-item--active" : ""}`}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  {getLabel(i)}
                  {sub ? <span className="vt-muted"> — {sub}</span> : null}
                </button>
              );
            })}
            {matches.length === 0 && (
              <div className="vt-map-empty">No matches for "{q}".</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PairingPanel({
  session,
  onPaired,
}: {
  session: GeotabSession;
  onPaired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<PairOptionsResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [unitId, setUnitId] = useState<string | null>(null);
  const [cameraHw, setCameraHw] = useState<string | null>(null);
  const [fuelType, setFuelType] = useState(FUEL_TYPES[0]);

  const [pairing, setPairing] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Load options the first time the panel is expanded.
  useEffect(() => {
    if (!open || opts || loading) return;
    setLoading(true);
    setLoadErr(null);
    fetchPairOptions(session)
      .then(setOpts)
      .catch((e) => setLoadErr(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [open, opts, loading, session]);

  const unit: PairGeotabUnit | null =
    opts?.units.find((u) => u.geotabDeviceId === unitId) ?? null;
  const camera: PairCamera | null =
    opts?.cameras.find((c) => c.hardwareId === cameraHw) ?? null;

  const vinWarning = useMemo(
    () => Boolean(unit && !unit.vin),
    [unit]
  );

  const handlePair = async () => {
    if (!unit || !camera) return;
    setPairing(true);
    setPairErr(null);
    setOkMsg(null);
    try {
      const res = await runPair({
        session,
        geotabDeviceId: unit.geotabDeviceId,
        cameraHardwareId: camera.hardwareId,
        fuelType,
      });
      setOkMsg(
        `${res.created ? "Created and paired" : "Paired"} — camera ${camera.hardwareId} is now "${res.vrn}".`
      );
      setUnitId(null);
      setCameraHw(null);
      // Refresh the options (currentVrn changed) and the association table.
      fetchPairOptions(session).then(setOpts).catch(() => {});
      onPaired();
    } catch (e) {
      setPairErr(friendlyError(e));
    } finally {
      setPairing(false);
    }
  };

  return (
    <div className="vt-pairpanel">
      <button
        type="button"
        className="vt-pairpanel-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="vt-pairpanel-caret">{open ? "▾" : "▸"}</span>
        Pair a camera
      </button>

      {open && (
        <div className="vt-pairpanel-body">
          {loadErr && <Banner type="error">{loadErr}</Banner>}
          {opts && !opts.canPair && (
            <Banner type="warning">
              You don't have permission to pair cameras. Ask an administrator, or
              someone with the GPSFMS – Manage Camera Rules clearance.
            </Banner>
          )}

          {loading && !opts && <div className="vt-empty">Loading units and cameras…</div>}

          {opts && opts.canPair && (
            <>
              <p className="vt-scope-note">
                Pick the Geotab unit and the camera, then Pair. The VisionTrack
                vehicle is named after the Geotab description (not the license
                plate) and its VIN is set to match — required fields you don't set
                are filled with safe defaults.
              </p>

              <div className="vt-pairgrid">
                <label className="vt-pairfield">
                  <span className="vt-pairlabel">Geotab unit</span>
                  <SearchSelect
                    items={opts.units}
                    value={unitId}
                    onChange={setUnitId}
                    getKey={(u) => u.geotabDeviceId}
                    getLabel={(u) => u.name}
                    getSub={(u) =>
                      [u.serial && `SN ${u.serial}`, u.vinLast6 && `VIN …${u.vinLast6}`]
                        .filter(Boolean)
                        .join("  ")
                    }
                    match={(u, q) =>
                      u.name.toLowerCase().includes(q) ||
                      u.serial.toLowerCase().includes(q) ||
                      u.vin.toLowerCase().includes(q)
                    }
                    placeholder="Search name, VIN, or serial…"
                    searchPlaceholder="Search name, VIN, or serial…"
                  />
                </label>

                <label className="vt-pairfield">
                  <span className="vt-pairlabel">Camera</span>
                  <SearchSelect
                    items={opts.cameras}
                    value={cameraHw}
                    onChange={setCameraHw}
                    getKey={(c) => c.hardwareId}
                    getLabel={(c) => c.hardwareId}
                    getSub={(c) =>
                      c.assigned ? `on ${c.currentVrn ?? "a vehicle"}` : "unassigned"
                    }
                    match={(c, q) =>
                      c.hardwareId.toLowerCase().includes(q) ||
                      (c.currentVrn ?? "").toLowerCase().includes(q)
                    }
                    placeholder="Search camera serial…"
                    searchPlaceholder="Search camera serial…"
                  />
                </label>

                <label className="vt-pairfield vt-pairfield--narrow">
                  <span className="vt-pairlabel">Fuel type</span>
                  <select
                    className="vt-input"
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value)}
                  >
                    {FUEL_TYPES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="vt-pairfield vt-pairfield--action">
                  <Button
                    type="primary"
                    onClick={handlePair}
                    disabled={!unit || !camera || pairing}
                  >
                    {pairing ? "Pairing…" : "Pair"}
                  </Button>
                </div>
              </div>

              {unit && camera && (
                <div className="vt-pairpreview">
                  Camera <b>{camera.hardwareId}</b>
                  {camera.assigned ? ` (currently on ${camera.currentVrn ?? "a vehicle"})` : ""} →
                  named <b>{unit.name}</b>
                  {unit.vin ? <>, VIN <b>{unit.vin}</b></> : ""}, fuel <b>{fuelType}</b>.
                </div>
              )}

              {vinWarning && (
                <Banner type="warning">
                  This Geotab unit has no usable VIN. The camera will be named and
                  fuel set, but with no VIN the automatic name-sync can't track it —
                  add a VIN in Geotab for durable matching.
                </Banner>
              )}

              {pairErr && (
                <Banner type="error" onClose={() => setPairErr(null)}>
                  {pairErr}
                </Banner>
              )}
              {okMsg && (
                <Banner type="success" onClose={() => setOkMsg(null)}>
                  {okMsg}
                </Banner>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
