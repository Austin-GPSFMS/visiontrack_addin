/**
 * Watchdog report — camera / GO device health per vehicle, judged against the
 * vehicle's ignition history rather than wall-clock time.
 *
 * Why ignition: the cameras are 3-wire installs, so they only have power while
 * ignition is on. A camera that last reported 5 days ago on a truck that has
 * been parked 5 days is fine; the same camera on a truck that has run every
 * day is dead. The proxy counts the ignition-ons the camera slept through
 * (`missedIgnitionOns`, with an upload-lag grace); the GO's own last
 * communication (it heartbeats while parked) is only used to judge the GO.
 *
 *   Camera issue  — the vehicle has had ≥ N ignition-ons since the camera last
 *                   reported (N = the picker). Camera power / SIM / hardware.
 *   GO issue      — GO silent > GO_STALE_HOURS, or the camera has reported
 *                   AFTER the GO's last comm (camera alive, GO dead).
 *   Camera + GO   — both of the above.
 *   Parked        — no ignition-on in the last IDLE_HOURS (and no missed
 *                   cycles). Not a fault; a parked or powered-down vehicle.
 *   OK            — camera reported at or after the most recent ignition-on.
 *
 * Rendered inside the Reporting hub; receives a ready session. Data is fetched
 * once; the pickers, site filter, sort and tiles work instantly on it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type { GeotabSession, WatchdogRow } from "../types";
import { friendlyError } from "../api/geotab";
import { fetchWatchdog } from "../api/proxy";
import { exportWatchdog } from "../utils/exportWatchdog";

/** "Flag the camera after this many missed ignition cycles." */
const MISSED_OPTIONS: Array<{ label: string; n: number }> = [
  { label: "1 ignition cycle", n: 1 },
  { label: "2 ignition cycles", n: 2 },
  { label: "3 ignition cycles", n: 3 },
  { label: "5 ignition cycles", n: 5 },
];

/** A GO that hasn't communicated in this long is stale — a healthy GO
 *  heartbeats within hours even while the vehicle is parked. */
export const GO_STALE_HOURS = 24;
/** Camera reporting this much after the GO's last comm = the GO is the dead one. */
const CAMERA_AFTER_GO_HOURS = 1;
/** No ignition-on for this long → the vehicle is parked, not faulty. */
const IDLE_HOURS = 72;

export type Diagnosis = "camera" | "go" | "cameraGo" | "parked" | "ok";

export const DIAGNOSIS_META: Record<Diagnosis, { label: string; cls: string; hint: string }> = {
  camera: {
    label: "Camera issue",
    cls: "vt-pill vt-pill--bad",
    hint: "The vehicle has run (ignition on) since the camera last reported — the camera is not coming up with ignition. Check camera power, SIM, or hardware.",
  },
  go: {
    label: "GO issue",
    cls: "vt-pill vt-pill--bad",
    hint: `GO device silent for more than ${GO_STALE_HOURS} h, or the camera has reported since the GO last did — the GO is the one not reporting. Check the GO install / harness.`,
  },
  cameraGo: {
    label: "Camera + GO",
    cls: "vt-pill vt-pill--bad",
    hint: "Both the camera has missed ignition cycles and the GO device has gone silent — likely a vehicle power problem or a pulled install.",
  },
  parked: {
    label: "Parked",
    cls: "vt-pill vt-pill--warn",
    hint: `No ignition-on in the last ${IDLE_HOURS} h and the camera reported on the last cycle it had power — a parked or powered-down vehicle, not a fault.`,
  },
  ok: {
    label: "OK",
    cls: "vt-pill vt-pill--ok",
    hint: "The camera reported on the vehicle's most recent ignition cycle and the GO is communicating.",
  },
};

type DiagFilter = "issues" | Diagnosis | "all";

/** Site/district group: Waste Pro-style "912 - Citrus County Landfill L011"
 *  (numeric division code + name). Falls back to "—" when no group carries a
 *  code, so other databases simply get a single bucket. */
const SITE_RE = /^\d{2,4}\s*[-–]\s*\S/;
const NO_SITE = "—";

export function siteOf(groups: string): string {
  const names = groups.split(",").map((s) => s.trim()).filter(Boolean);
  return names.find((n) => SITE_RE.test(n)) ?? NO_SITE;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  return Number.isNaN(d) ? null : (Date.now() - d) / 3_600_000;
}

function fmtAgo(iso: string | null): string {
  const h = hoursSince(iso);
  if (h == null) return "Never";
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function fmtExact(iso: string | null): string {
  if (!iso) return "Never reported";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function diagnose(r: WatchdogRow, missedThreshold: number): Diagnosis {
  const go = hoursSince(r.geotabLastComm);
  const goStale = go == null || go > GO_STALE_HOURS;
  const cameraAfterGo =
    r.cameraLastReported != null &&
    r.geotabLastComm != null &&
    new Date(r.cameraLastReported).getTime() - new Date(r.geotabLastComm).getTime() >
      CAMERA_AFTER_GO_HOURS * 3_600_000;
  const goIssue = goStale || cameraAfterGo;
  const camIssue = r.missedIgnitionOns >= missedThreshold;

  if (camIssue && goIssue) return "cameraGo";
  if (camIssue) return "camera";
  if (goIssue) return "go";
  const ign = hoursSince(r.lastIgnitionOn);
  if (ign == null || ign > IDLE_HOURS) return "parked";
  return "ok";
}

export interface WatchdogRowView extends WatchdogRow {
  site: string;
  diagnosis: Diagnosis;
}

type SortCol = "vehicle" | "site" | "groups" | "camera" | "ignition" | "go" | "missed" | "diagnosis";
interface SortState {
  col: SortCol;
  dir: 1 | -1;
}

const DIAG_ORDER: Record<Diagnosis, number> = { cameraGo: 0, camera: 1, go: 2, parked: 3, ok: 4 };

/** Stale-first ordering for a timestamp column (null = never = most stale). */
function staleness(iso: string | null): number {
  const h = hoursSince(iso);
  return h == null ? Number.POSITIVE_INFINITY : h;
}

function compareRows(a: WatchdogRowView, b: WatchdogRowView, sort: SortState): number {
  const byVehicle = () => a.geotabDeviceName.localeCompare(b.geotabDeviceName, undefined, { numeric: true });
  let c = 0;
  switch (sort.col) {
    case "vehicle":
      c = byVehicle();
      break;
    case "site":
      // Unassigned ("—") always sinks to the bottom regardless of direction.
      if (a.site === NO_SITE && b.site !== NO_SITE) return 1;
      if (b.site === NO_SITE && a.site !== NO_SITE) return -1;
      c = a.site.localeCompare(b.site, undefined, { numeric: true });
      break;
    case "groups":
      c = a.geotabGroups.localeCompare(b.geotabGroups);
      break;
    case "camera":
      c = staleness(b.cameraLastReported) - staleness(a.cameraLastReported); // stalest first
      break;
    case "ignition":
      c = staleness(b.lastIgnitionOn) - staleness(a.lastIgnitionOn);
      break;
    case "go":
      c = staleness(b.geotabLastComm) - staleness(a.geotabLastComm);
      break;
    case "missed":
      c = b.missedIgnitionOns - a.missedIgnitionOns; // most missed first
      break;
    case "diagnosis":
      c = DIAG_ORDER[a.diagnosis] - DIAG_ORDER[b.diagnosis];
      break;
  }
  if (c === 0 && sort.col !== "vehicle") c = byVehicle();
  return c * sort.dir;
}

function SortHeader({
  col,
  label,
  sort,
  onSort,
  title,
}: {
  col: SortCol;
  label: string;
  sort: SortState;
  onSort: (col: SortCol) => void;
  title?: string;
}) {
  const active = sort.col === col;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`vt-th-sort${active ? " vt-th-sort--active" : ""}`}
        onClick={() => onSort(col)}
        title={title ?? `Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className="vt-th-caret" aria-hidden>
          {active ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

export function WatchdogReport({ session }: { session: GeotabSession }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchdogRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [ignitionAvailable, setIgnitionAvailable] = useState(true);
  const [graceHours, setGraceHours] = useState(2);
  const [missedThreshold, setMissedThreshold] = useState(2);
  const [diagFilter, setDiagFilter] = useState<DiagFilter>("issues");
  const [siteFilter, setSiteFilter] = useState<string>("");
  const [sort, setSort] = useState<SortState>({ col: "site", dir: 1 });
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWatchdog(session);
      setRows(r.rows);
      setGeneratedAt(r.generatedAt);
      setIgnitionAvailable(r.ignitionAvailable !== false);
      if (r.cameraUploadGraceHours) setGraceHours(r.cameraUploadGraceHours);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enrich once per threshold change; everything else filters/sorts this.
  const views = useMemo<WatchdogRowView[]>(
    () =>
      rows.map((r) => ({
        ...r,
        site: siteOf(r.geotabGroups),
        diagnosis: diagnose(r, missedThreshold),
      })),
    [rows, missedThreshold]
  );

  const sites = useMemo(() => {
    const s = new Set(views.map((v) => v.site));
    return [...s].sort((a, b) => {
      if (a === NO_SITE) return 1;
      if (b === NO_SITE) return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [views]);

  // Counts respect the site filter (so the tiles describe what you're looking at).
  const inSite = useMemo(
    () => (siteFilter ? views.filter((v) => v.site === siteFilter) : views),
    [views, siteFilter]
  );
  const counts = useMemo(() => {
    const c: Record<Diagnosis, number> = { camera: 0, go: 0, cameraGo: 0, parked: 0, ok: 0 };
    for (const v of inSite) c[v.diagnosis]++;
    return { ...c, issues: c.camera + c.go + c.cameraGo, all: inSite.length };
  }, [inSite]);

  const shown = useMemo(() => {
    const filtered = inSite.filter((v) => {
      if (diagFilter === "all") return true;
      if (diagFilter === "issues") return v.diagnosis === "camera" || v.diagnosis === "go" || v.diagnosis === "cameraGo";
      return v.diagnosis === diagFilter;
    });
    return [...filtered].sort((a, b) => compareRows(a, b, sort));
  }, [inSite, diagFilter, sort]);

  const onSort = useCallback((col: SortCol) => {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportWatchdog(shown, {
        database: session.database,
        missedThreshold,
        goStaleHours: GO_STALE_HOURS,
        siteFilter: siteFilter || "All sites",
        diagnosisFilter:
          diagFilter === "all" ? "All" : diagFilter === "issues" ? "Issues only" : DIAGNOSIS_META[diagFilter].label,
        generatedAt: generatedAt ?? new Date().toISOString(),
      });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }, [shown, session.database, missedThreshold, siteFilter, diagFilter, generatedAt]);

  const tile = (key: DiagFilter, label: string, n: number, cls = "") => (
    <button
      type="button"
      className={`vt-stat${cls ? ` ${cls}` : ""}${diagFilter === key ? " vt-stat--active" : ""}`}
      onClick={() => setDiagFilter(key)}
      title={key in DIAGNOSIS_META ? DIAGNOSIS_META[key as Diagnosis].hint : undefined}
    >
      <b>{n}</b> {label}
    </button>
  );

  /** "3 missed · last on 5 d ago · drove 6 d ago" for the ignition cell tooltip. */
  const ignitionTitle = (r: WatchdogRowView): string => {
    const parts: string[] = [];
    parts.push(
      r.lastIgnitionOn
        ? `Last ignition on: ${fmtExact(r.lastIgnitionOn)}`
        : `No ignition-on in the last ${r.ignitionLookbackDays} days`
    );
    if (r.lastIgnitionOff) parts.push(`Last ignition off: ${fmtExact(r.lastIgnitionOff)}`);
    parts.push(r.lastTripStop ? `Last drove: ${fmtExact(r.lastTripStop)}` : "No trips in the last 7 days");
    parts.push(
      `${r.ignitionOnsSinceCamera} ignition-on${r.ignitionOnsSinceCamera === 1 ? "" : "s"} since the camera last reported` +
        (r.ignitionOnsSinceCamera !== r.missedIgnitionOns
          ? ` (${r.missedIgnitionOns} counted — the rest are within the ${graceHours} h upload grace)`
          : "")
    );
    return parts.join("\n");
  };

  return (
    <div>
      <p className="vt-scope-note">
        Camera and GO device health for vehicles in your group scope, judged
        against ignition: a 3-wire camera only has power while the vehicle is
        running, so a camera is flagged only when the vehicle has had ignition on
        and the camera didn't report. The GO is flagged after {GO_STALE_HOURS} h
        of silence.
        {generatedAt ? ` Last run ${new Date(generatedAt).toLocaleString()}.` : ""}
      </p>

      {error && <Banner type="error" onClose={() => setError(null)}>{error}</Banner>}
      {!ignitionAvailable && rows.length > 0 && (
        <Banner type="warning">
          Ignition history couldn't be loaded from Geotab for this run, so every
          vehicle shows as Parked or OK on the camera side. Refresh to retry.
        </Banner>
      )}

      <div className="vt-toolbar">
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>Flag camera after</span>
          <select
            className="vt-input"
            value={missedThreshold}
            onChange={(e) => setMissedThreshold(Number(e.target.value))}
            title="How many ignition-ons the camera can sleep through before it's called a fault"
          >
            {MISSED_OPTIONS.map((o) => (
              <option key={o.n} value={o.n}>{o.label} missed</option>
            ))}
          </select>
        </label>
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>Site / district</span>
          <select
            className="vt-input"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
          >
            <option value="">All sites ({sites.length})</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s === NO_SITE ? "No site group" : s}
              </option>
            ))}
          </select>
        </label>
        <div className="vt-spacer" />
        <Button type="secondary" onClick={handleExport} disabled={exporting || rows.length === 0}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
        <Button type="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="vt-empty">Checking devices and ignition history…</div>
      ) : (
        <>
          <div className="vt-summary">
            {tile("issues", "with an issue", counts.issues)}
            {tile("camera", "camera issue", counts.camera, "vt-stat--bad")}
            {tile("go", "GO issue", counts.go, "vt-stat--bad")}
            {counts.cameraGo > 0 && tile("cameraGo", "camera + GO", counts.cameraGo, "vt-stat--bad")}
            {tile("parked", "parked", counts.parked, "vt-stat--warn")}
            {tile("ok", "OK", counts.ok, "vt-stat--ok")}
            {tile("all", `all${siteFilter ? " at site" : ""}`, counts.all)}
          </div>

          <p className="vt-scope-note">
            Showing <strong>{shown.length}</strong> of {counts.all} vehicle
            {counts.all === 1 ? "" : "s"}
            {siteFilter ? ` at ${siteFilter === NO_SITE ? "no site group" : siteFilter}` : ""} · camera
            flagged after {missedThreshold} missed ignition cycle{missedThreshold === 1 ? "" : "s"} ({graceHours} h
            upload grace) · GO flagged after {GO_STALE_HOURS} h.
          </p>

          <table className="vt-table">
            <thead>
              <tr>
                <SortHeader col="vehicle" label="Vehicle" sort={sort} onSort={onSort} />
                <SortHeader col="site" label="Site / district" sort={sort} onSort={onSort} />
                <SortHeader col="groups" label="Other group(s)" sort={sort} onSort={onSort} />
                <SortHeader col="camera" label="Camera last reported" sort={sort} onSort={onSort} />
                <SortHeader
                  col="ignition"
                  label="Last ignition on"
                  sort={sort}
                  onSort={onSort}
                  title="Sort by last ignition on (GO device) — the last time the camera should have had power"
                />
                <SortHeader
                  col="missed"
                  label="Missed cycles"
                  sort={sort}
                  onSort={onSort}
                  title="Ignition-ons since the camera last reported (excluding ones still inside the upload grace)"
                />
                <SortHeader col="go" label="GO last comm" sort={sort} onSort={onSort} />
                <SortHeader col="diagnosis" label="Diagnosis" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const meta = DIAGNOSIS_META[r.diagnosis];
                const otherGroups = r.geotabGroups
                  .split(",")
                  .map((s) => s.trim())
                  .filter((g) => g && g !== r.site)
                  .join(", ");
                const camBad = r.diagnosis === "camera" || r.diagnosis === "cameraGo";
                const goBad = r.diagnosis === "go" || r.diagnosis === "cameraGo";
                return (
                  <tr key={(r.hardwareId ?? "") + r.geotabDeviceName}>
                    <td>
                      {r.geotabDeviceName}
                      {r.vrn && r.vrn !== r.geotabDeviceName ? ` (${r.vrn})` : ""}
                    </td>
                    <td>{r.site === NO_SITE ? <span className="vt-muted">—</span> : r.site}</td>
                    <td className="vt-muted">{otherGroups || "—"}</td>
                    <td className={camBad ? "vt-cell-stale" : ""} title={fmtExact(r.cameraLastReported)}>
                      {fmtAgo(r.cameraLastReported)}
                    </td>
                    <td title={ignitionTitle(r)}>
                      {r.lastIgnitionOn ? (
                        fmtAgo(r.lastIgnitionOn)
                      ) : (
                        <span className="vt-muted">none in {r.ignitionLookbackDays} d</span>
                      )}
                    </td>
                    <td className={camBad ? "vt-cell-stale" : ""} title={ignitionTitle(r)}>
                      {r.missedIgnitionOns > 0 ? (
                        r.missedIgnitionOns
                      ) : r.ignitionOnsSinceCamera > 0 ? (
                        <span className="vt-muted" title={`${r.ignitionOnsSinceCamera} inside the ${graceHours} h upload grace`}>
                          0 ({r.ignitionOnsSinceCamera} pending)
                        </span>
                      ) : (
                        <span className="vt-muted">0</span>
                      )}
                    </td>
                    <td className={goBad ? "vt-cell-stale" : ""} title={fmtExact(r.geotabLastComm)}>
                      {fmtAgo(r.geotabLastComm)}
                    </td>
                    <td>
                      <span className={meta.cls} title={meta.hint}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="vt-table-empty">
                    {counts.all === 0
                      ? "No vehicles in scope."
                      : diagFilter === "issues"
                        ? "No camera or GO issues at this threshold."
                        : "No vehicles match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
