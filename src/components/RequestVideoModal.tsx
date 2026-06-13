/**
 * Standalone "Request Video" modal: pick a scoped vehicle, a start time (the
 * user's local time), a duration, and which camera channels, then submit an
 * on-demand clip request. The camera uploads the footage and it appears in the
 * Requests list when ready.
 */

import { useEffect, useState } from "react";
import type { DeviceChannel, GeotabSession, ScopedVehicle } from "../types";
import { fetchDeviceChannels, requestVideo } from "../api/proxy";
import { friendlyError } from "../api/geotab";
import { VehicleSelect } from "./VehicleSelect";

/** Default datetime-local value: now, rounded to the minute, local time. */
function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RequestVideoModal({
  session,
  vehicles,
  initialVehicleHardwareId,
  onClose,
  onSubmitted,
}: {
  session: GeotabSession;
  vehicles: ScopedVehicle[];
  initialVehicleHardwareId?: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [hardwareId, setHardwareId] = useState(initialVehicleHardwareId ?? "");
  const [startLocal, setStartLocal] = useState(nowLocalInput());
  const [duration, setDuration] = useState(30);
  const [channels, setChannels] = useState<DeviceChannel[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicle = vehicles.find((v) => v.hardwareId === hardwareId);

  // Load camera channels when the vehicle changes.
  useEffect(() => {
    if (!hardwareId) {
      setChannels([]);
      setSelectedChannels([]);
      return;
    }
    let cancelled = false;
    setLoadingChannels(true);
    fetchDeviceChannels({ session, hardwareId, vehicleId: vehicle?.vehicleId })
      .then((r) => {
        if (cancelled) return;
        setChannels(r.channels);
        setSelectedChannels(r.channels.map((c) => c.channel)); // default all
      })
      .catch((e) => !cancelled && setError(friendlyError(e)))
      .finally(() => !cancelled && setLoadingChannels(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareId]);

  const submit = async () => {
    setError(null);
    if (!hardwareId) return setError("Pick a vehicle.");
    if (selectedChannels.length === 0) return setError("Select at least one camera.");
    const startIso = new Date(startLocal).toISOString();
    setBusy(true);
    try {
      await requestVideo({
        session,
        hardwareId,
        vehicleId: vehicle?.vehicleId,
        startDateTime: startIso,
        duration,
        channels: selectedChannels,
      });
      onSubmitted();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div className="vt-modal" style={{ width: "min(560px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="vt-modal-head">
          <div className="vt-modal-title">Request video</div>
          <button className="vt-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <div className="vt-hint" style={{ color: "#c43232" }}>{error}</div>}

        <div className="vt-field">
          <span>Vehicle</span>
          <VehicleSelect vehicles={vehicles} value={hardwareId} onChange={setHardwareId} />
        </div>

        <label className="vt-field">
          <span>Start time (your local time)</span>
          <input
            className="vt-input"
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </label>

        <label className="vt-field">
          <span>Duration (seconds, max 180)</span>
          <input
            className="vt-input vt-input--narrow"
            type="number"
            min={5}
            max={180}
            value={duration}
            onChange={(e) => setDuration(Math.min(180, Math.max(5, Number(e.target.value))))}
          />
        </label>

        <div className="vt-field">
          <span>Cameras</span>
          {!hardwareId ? (
            <small className="vt-hint">Pick a vehicle to load its cameras.</small>
          ) : loadingChannels ? (
            <small className="vt-hint">Loading cameras…</small>
          ) : channels.length === 0 ? (
            <small className="vt-hint">No cameras reported for this vehicle.</small>
          ) : (
            <div className="vt-listchecks">
              {channels.map((c) => (
                <label key={c.channel} className="vt-checkrow">
                  <input
                    type="checkbox"
                    checked={selectedChannels.includes(c.channel)}
                    onChange={() =>
                      setSelectedChannels((prev) =>
                        prev.includes(c.channel)
                          ? prev.filter((x) => x !== c.channel)
                          : [...prev, c.channel]
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="vt-editor-actions">
          <button className="vt-btn vt-btn--primary" onClick={submit} disabled={busy}>
            {busy ? "Requesting…" : "Request clip"}
          </button>
          <button className="vt-btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
        <small className="vt-hint">
          The camera uploads the footage over cellular — it'll appear in the
          Requests list in a few minutes.
        </small>
      </div>
    </div>
  );
}
