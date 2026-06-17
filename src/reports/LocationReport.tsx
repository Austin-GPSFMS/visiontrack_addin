/**
 * GPS vs Camera location report — for each scoped camera vehicle, the GO
 * device's last position (Geotab) next to the camera's own last reported
 * position (VisionTrack), each with a reverse-geocoded address (server-cached)
 * linking to Google Maps, plus the drift between the two fixes.
 */

import { useCallback, useEffect, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type { GeotabSession, LatLon, PositionRow } from "../types";
import { friendlyError } from "../api/geotab";
import { fetchPositions, reverseGeocode } from "../api/proxy";

function fmtAgo(iso: string | null): string {
  if (!iso) return "no fix";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (Number.isNaN(h)) return "no fix";
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function driftLabel(m: number): string {
  const ft = m * 3.28084;
  return ft < 1000 ? `${Math.round(ft)} ft` : `${(m / 1609.34).toFixed(2)} mi`;
}

/** One coordinate cell: map link + lazily reverse-geocoded address + age. */
function GeoCell({ session, pos }: { session: GeotabSession; pos: LatLon | null }) {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    reverseGeocode(session, pos.lat, pos.lon)
      .then((r) => !cancelled && setAddr(r.address || null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, pos]);

  if (!pos) return <span className="vt-muted">—</span>;
  const coords = `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${pos.lat},${pos.lon}`;
  return (
    <div>
      <a href={maps} target="_blank" rel="noopener noreferrer" className="vt-link">
        {addr || coords}
      </a>
      <div className="vt-hint">
        {addr ? `${coords} · ` : ""}
        {fmtAgo(pos.t)}
      </div>
    </div>
  );
}

export function LocationReport({ session }: { session: GeotabSession }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchPositions(session);
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

  return (
    <div>
      <p className="vt-scope-note">
        The GO device's last GPS position next to the camera's own last reported
        position, for camera-equipped vehicles in your scope. A large drift means
        the camera's GPS disagrees with the GO device — worth a look.
        {generatedAt ? ` Last run ${new Date(generatedAt).toLocaleString()}.` : ""}
        {" "}Addresses fill in as they're looked up.
      </p>

      {error && (
        <Banner type="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="vt-toolbar">
        <div className="vt-spacer" />
        <Button type="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="vt-empty">Pulling positions…</div>
      ) : (
        <table className="vt-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Group(s)</th>
              <th>GPS (GO device)</th>
              <th>Camera (VisionTrack)</th>
              <th>Drift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.geotabDeviceName + (r.vrn ?? "")}>
                <td>
                  {r.geotabDeviceName}
                  {r.vrn && r.vrn !== r.geotabDeviceName ? ` (${r.vrn})` : ""}
                </td>
                <td>{r.geotabGroups}</td>
                <td>
                  <GeoCell session={session} pos={r.gps} />
                </td>
                <td>
                  <GeoCell session={session} pos={r.camera} />
                </td>
                <td>
                  {r.driftMeters == null ? (
                    <span className="vt-muted">—</span>
                  ) : (
                    <span
                      className={
                        r.driftMeters > 150
                          ? "vt-pill vt-pill--warn"
                          : "vt-pill vt-pill--ok"
                      }
                    >
                      {driftLabel(r.driftMeters)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="vt-table-empty">
                  No camera-equipped vehicles in scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
