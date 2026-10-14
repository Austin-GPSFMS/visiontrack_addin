/**
 * Watchdog report — vehicles whose camera (or GO device) hasn't reported
 * within a chosen threshold. Rendered inside the Reporting hub; receives a
 * ready session. Last-contact times are fetched once; the threshold picker,
 * site filter, sort and diagnosis tiles all work instantly on the loaded
 * rows. Scope-gated to the user's groups.
 *
 * Diagnosis compares the camera's last report with the GO device's last
 * communication so a reviewer can tell WHICH side is the problem:
 *   Camera issue  — camera silent beyond the threshold, GO still reporting
 *                   (camera power/SIM/hardware — the vehicle is clearly alive)
 *   GO issue      — GO silent > GO_STALE_HOURS, camera still reporting
 *   Both silent   — neither has reported; usually a parked/idle vehicle, not
 *                   a fault, but worth a look if it persists
 *   OK            — both within their thresholds
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type { GeotabSession, WatchdogRow } from "../types";
import { friendlyError } from "../api/geotab";
import { fetchWatchdog } from "../api/proxy";
import { exportWatchdog } from "../utils/exportWatchdog";

const THRESHOLDS: Array<{ label: string; hours: number }> = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "5 days", hours: 120 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

/** A GO device that hasn't communicated in this long is considered stale,
 *  independent of the camera threshold (a healthy GO checks in within hours). */
export const GO_STALE_HOURS = 24;

export type Diagnosis = "camera" | "go" | "both" | "ok";

export const DIAGNOSIS_META: Record<Diagnosis, { label: string; cls: string; hint: string }> = {
  camera: {
    label: "Camera issue",
    cls: "vt-pill vt-pill--bad",
    hint: "Camera silent beyond the threshold while the GO device is still reporting — check camera power, SIM, or hardware.",
  },
  go: {
    label: "GO issue",
    cls: "vt-pill vt-pill--bad",
    hint: `GO device silent for more than ${GO_STALE_HOURS} h while the camera is still reporting — check the GO install / harness.`,
  },
  both: {
    label: "Both silent",
    cls: "vt-pill vt-pill--warn",
    hint: "Neither the camera nor the GO device has reported — usually a parked or powered-down vehicle, not a hardware fault.",
  },
  ok: {
    label: "OK",
    cls: "vt-pill vt-pill--ok",
    hint: "Both devices reported within their thresholds.",
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

export function diagnose(r: WatchdogRow, cameraThresholdH: number): Diagnosis {
  const cam = hoursSince(r.cameraLastReported);
  const go = hoursSince(r.geotabLastComm);
  const camStale = cam == null || cam > cameraThresholdH;
  const goStale = go == null || go > GO_STALE_HOURS;
  if (camStale && goStale) return "both";
  if (camStale) return "camera";
  if (goStale) return "go";
  return "ok";
}

/** Hours between the two devices' last reports (how far they've drifted apart). */
function gapHours(r: WatchdogRow): number | null {
  const cam = hoursSince(r.cameraLastReported);
  const go = hoursSince(r.geotabLastComm);
  if (cam == null || go == null) return null;
  return Math.abs(cam - go);
}

function fmtGap(h: number | null): string {
  if (h == null) return "";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

export interface WatchdogRowView extends WatchdogRow {
  site: string;
  diagnosis: Diagnosis;
  gapHours: number | null;
}

type SortCol = "vehicle" | "site" | "groups" | "camera" | "go" | "diagnosis";
interface SortState {
  col: SortCol;
  dir: 1 | -1;
}

const DIAG_ORDER: Record<Diagnosis, number> = { camera: 0, go: 1, both: 2, ok: 3 };

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
    case "go":
      c = staleness(b.geotabLastComm) - staleness(a.geotabLastComm);
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
}: {
  col: SortCol;
  label: string;
  sort: SortState;
  onSort: (col: SortCol) => void;
}) {
  const active = sort.col === col;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`vt-th-sort${active ? " vt-th-sort--active" : ""}`}
        onClick={() => onSort(col)}
        title={`Sort by ${label.toLowerCase()}`}
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
  const [thresholdH, setThresholdH] = useState(72);
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
        diagnosis: diagnose(r, thresholdH),
        gapHours: gapHours(r),
      })),
    [rows, thresholdH]
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
    const c: Record<Diagnosis, number> = { camera: 0, go: 0, both: 0, ok: 0 };
    for (const v of inSite) c[v.diagnosis]++;
    return { ...c, issues: c.camera + c.go + c.both, all: inSite.length };
  }, [inSite]);

  const shown = useMemo(() => {
    const filtered = inSite.filter((v) => {
      if (diagFilter === "all") return true;
      if (diagFilter === "issues") return v.diagnosis !== "ok";
      return v.diagnosis === diagFilter;
    });
    return [...filtered].sort((a, b) => compareRows(a, b, sort));
  }, [inSite, diagFilter, sort]);

  const onSort = useCallback((col: SortCol) => {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  }, []);

  const thresholdLabel = THRESHOLDS.find((t) => t.hours === thresholdH)?.label ?? "";

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportWatchdog(shown, {
        database: session.database,
        thresholdLabel,
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
  }, [shown, session.database, thresholdLabel, siteFilter, diagFilter, generatedAt]);

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

  return (
    <div>
      <p className="vt-scope-note">
        Cameras and GO devices that haven't reported within their windows, for
        vehicles in your group scope. Camera threshold is adjustable; a GO device
        is flagged after {GO_STALE_HOURS} h. Comparing the two tells you which side
        to look at.
        {generatedAt ? ` Last run ${new Date(generatedAt).toLocaleString()}.` : ""}
      </p>

      {error && <Banner type="error" onClose={() => setError(null)}>{error}</Banner>}

      <div className="vt-toolbar">
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>Camera offline threshold</span>
          <select
            className="vt-input"
            value={thresholdH}
            onChange={(e) => setThresholdH(Number(e.target.value))}
          >
            {THRESHOLDS.map((t) => (
              <option key={t.hours} value={t.hours}>{t.label}</option>
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
        <div className="vt-empty">Checking devices…</div>
      ) : (
        <>
          <div className="vt-summary">
            {tile("issues", "with an issue", counts.issues)}
            {tile("camera", "camera issue", counts.camera, "vt-stat--bad")}
            {tile("go", "GO issue", counts.go, "vt-stat--bad")}
            {tile("both", "both silent", counts.both, "vt-stat--warn")}
            {tile("ok", "OK", counts.ok, "vt-stat--ok")}
            {tile("all", `all${siteFilter ? " at site" : ""}`, counts.all)}
          </div>

          <p className="vt-scope-note">
            Showing <strong>{shown.length}</strong> of {counts.all} vehicle
            {counts.all === 1 ? "" : "s"}
            {siteFilter ? ` at ${siteFilter === NO_SITE ? "no site group" : siteFilter}` : ""} · camera threshold{" "}
            {thresholdLabel} · GO threshold {GO_STALE_HOURS} h.
          </p>

          <table className="vt-table">
            <thead>
              <tr>
                <SortHeader col="vehicle" label="Vehicle" sort={sort} onSort={onSort} />
                <SortHeader col="site" label="Site / district" sort={sort} onSort={onSort} />
                <SortHeader col="groups" label="Other group(s)" sort={sort} onSort={onSort} />
                <SortHeader col="camera" label="Camera last reported" sort={sort} onSort={onSort} />
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
                const gap = fmtGap(r.gapHours);
                return (
                  <tr key={(r.hardwareId ?? "") + r.geotabDeviceName}>
                    <td>
                      {r.geotabDeviceName}
                      {r.vrn && r.vrn !== r.geotabDeviceName ? ` (${r.vrn})` : ""}
                    </td>
                    <td>{r.site === NO_SITE ? <span className="vt-muted">—</span> : r.site}</td>
                    <td className="vt-muted">{otherGroups || "—"}</td>
                    <td
                      className={r.diagnosis === "camera" || r.diagnosis === "both" ? "vt-cell-stale" : ""}
                      title={fmtExact(r.cameraLastReported)}
                    >
                      {fmtAgo(r.cameraLastReported)}
                    </td>
                    <td
                      className={r.diagnosis === "go" || r.diagnosis === "both" ? "vt-cell-stale" : ""}
                      title={fmtExact(r.geotabLastComm)}
                    >
                      {fmtAgo(r.geotabLastComm)}
                    </td>
                    <td>
                      <span className={meta.cls} title={meta.hint}>
                        {meta.label}
                      </span>
                      {r.diagnosis !== "ok" && r.diagnosis !== "both" && gap && (
                        <span className="vt-hint vt-gap" title="How far apart the two devices' last reports are">
                          {gap} apart
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="vt-table-empty">
                    {counts.all === 0
                      ? "No vehicles in scope."
                      : diagFilter === "ok"
                        ? "Nothing is fully online in this view."
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
