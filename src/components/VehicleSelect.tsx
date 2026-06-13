/**
 * Searchable single-select vehicle picker for the Dashboard toolbar.
 * Value is a hardwareId ("" = all vehicles).
 */

import { useEffect, useRef, useState } from "react";
import type { ScopedVehicle } from "../types";

function labelFor(v: ScopedVehicle): string {
  return v.vrn && v.vrn !== v.geotabDeviceName
    ? `${v.geotabDeviceName} (${v.vrn})`
    : v.geotabDeviceName;
}

export function VehicleSelect({
  vehicles,
  value,
  onChange,
}: {
  vehicles: ScopedVehicle[];
  value: string;
  onChange: (hardwareId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = vehicles.find((v) => v.hardwareId === value);
  const triggerLabel = selected ? labelFor(selected) : "Vehicle: All";

  const query = q.trim().toLowerCase();
  const matches = (query
    ? vehicles.filter(
        (v) =>
          v.hardwareId &&
          (labelFor(v).toLowerCase().includes(query) ||
            (v.vrn ?? "").toLowerCase().includes(query))
      )
    : vehicles.filter((v) => v.hardwareId)
  ).slice(0, 50);

  const pick = (hardwareId: string) => {
    onChange(hardwareId);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="vt-vehsel" ref={rootRef}>
      <button
        type="button"
        className="vt-vehsel-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? "" : "vt-muted"}>{triggerLabel}</span>
        <span className="vt-vehsel-caret">▾</span>
      </button>
      {open && (
        <div className="vt-vehsel-menu">
          <input
            className="vt-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vehicles…"
          />
          <div className="vt-vehsel-list">
            <button
              type="button"
              className={`vt-vehsel-item${value === "" ? " vt-vehsel-item--active" : ""}`}
              onClick={() => pick("")}
            >
              All vehicles
            </button>
            {matches.map((v) => (
              <button
                key={v.hardwareId}
                type="button"
                className={`vt-vehsel-item${
                  value === v.hardwareId ? " vt-vehsel-item--active" : ""
                }`}
                onClick={() => pick(v.hardwareId as string)}
              >
                {labelFor(v)}
              </button>
            ))}
            {matches.length === 0 && (
              <div className="vt-map-empty">No vehicles match "{q}".</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
