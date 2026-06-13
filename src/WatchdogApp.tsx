/**
 * Watchdog report — vehicles whose camera (or GO device) hasn't reported
 * within a chosen threshold. Fetches last-contact times once; the threshold
 * picker filters instantly. Scope-gated to the user's groups.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type { GeotabApi, GeotabSession, WatchdogRow } from "./types";
import { friendlyError, getSession } from "./api/geotab";
import { fetchWatchdog } from "./api/proxy";

interface AppProps {
  api: GeotabApi | null;
}

const THRESHOLDS: Array<{ label: string; hours: number }> = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "5 days", hours: 120 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return (Date.now() - d) / 3_600_000;
}

function fmtAgo(iso: string | null): string {
  const h = hoursSince(iso);
  if (h == null) return "Never";
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function WatchdogApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WatchdogRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [thresholdH, setThresholdH] = useState(72);
  const [onlyOffline, setOnlyOffline] = useState(true);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getSession(api)
      .then((s) => !cancelled && setSession(s))
      .catch((e) => !cancelled && setBootError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(async () => {
    if (!session) return;
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
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const isOffline = useCallback(
    (r: WatchdogRow) => {
      const cam = hoursSince(r.cameraLastReported);
      // Offline if the camera hasn't reported within the threshold (or never).
      return cam == null || cam > thresholdH;
    },
    [thresholdH]
  );

  const shown = useMemo(
    () => rows.filter((r) => (onlyOffline ? isOffline(r) : true)),
    [rows, onlyOffline, isOffline]
  );
  const offlineCount = useMemo(() => rows.filter(isOffline).length, [rows, isOffline]);

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>Watchdog</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }
  if (bootError) return <Banner type="error">{bootError}</Banner>;

  return (
    <div>
      <div className="vt-header">
        <h1>Watchdog</h1>
        <Button type="secondary" onClick={() => void load()} disabled={loading || !session}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <p className="vt-scope-note">
        Cameras (and GO devices) that haven't reported within your chosen
        window, for vehicles in your group scope.
        {generatedAt ? ` Last run ${new Date(generatedAt).toLocaleString()}.` : ""}
      </p>

      {error && <Banner type="error" onClose={() => setError(null)}>{error}</Banner>}

      <div className="vt-toolbar">
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>Offline threshold</span>
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
        <label className="vt-checkrow" style={{ alignSelf: "flex-end" }}>
          <input
            type="checkbox"
            checked={onlyOffline}
            onChange={(e) => setOnlyOffline(e.target.checked)}
          />
          Show offline only
        </label>
      </div>

      {loading && rows.length === 0 ? (
        <div className="vt-empty">Checking devices…</div>
      ) : (
        <>
          <p className="vt-scope-note">
            <strong>{offlineCount}</strong> of {rows.length} cameras offline
            beyond {THRESHOLDS.find((t) => t.hours === thresholdH)?.label}.
          </p>
          <table className="vt-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Group(s)</th>
                <th>Camera last reported</th>
                <th>GO last comm</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const off = isOffline(r);
                return (
                  <tr key={(r.hardwareId ?? "") + r.geotabDeviceName}>
                    <td>{r.geotabDeviceName}{r.vrn && r.vrn !== r.geotabDeviceName ? ` (${r.vrn})` : ""}</td>
                    <td>{r.geotabGroups}</td>
                    <td>{fmtAgo(r.cameraLastReported)}</td>
                    <td>{fmtAgo(r.geotabLastComm)}</td>
                    <td>
                      <span className={off ? "vt-pill vt-pill--bad" : "vt-pill vt-pill--ok"}>
                        {off ? "Offline" : "Online"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="vt-table-empty">
                    {onlyOffline ? "No cameras offline beyond this threshold." : "No vehicles in scope."}
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
