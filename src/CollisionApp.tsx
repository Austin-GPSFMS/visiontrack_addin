/**
 * Collision Center — triage queue of detected collisions.
 *
 * Source: Geotab Possible/Major Collision events, filtered server-side to
 * vehicles with a paired VisionTrack camera within the user's scope. Each row
 * can be Confirmed or Dismissed (false positives). The detail view (footage,
 * speed/accelerometer graphs, map, raw log, "Download all accident data") is
 * built on top of this list next.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  CollisionRow,
  CollisionStatus,
  CollisionsResponse,
  GeotabGroup,
  GeotabApi,
  GeotabSession,
} from "./types";
import { fetchScopedGroups, friendlyError, getSession } from "./api/geotab";
import { fetchCollisions, setCollisionTriage } from "./api/proxy";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { CollisionSourcesModal } from "./components/CollisionSourcesModal";

interface AppProps {
  api: GeotabApi | null;
}

const RANGE_OPTIONS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const SEVERITY_META: Record<CollisionRow["severity"], { label: string; cls: string }> = {
  major: { label: "Major", cls: "vt-pill vt-pill--bad" },
  possible: { label: "Possible", cls: "vt-pill vt-pill--warn" },
  other: { label: "Collision", cls: "vt-pill" },
};

type StatusFilter = "active" | "new" | "confirmed" | "dismissed" | "all";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CollisionApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(new Map());
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(["GroupCompanyId"]);
  const [rangeDays, setRangeDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CollisionsResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    Promise.all([getSession(api), fetchScopedGroups(api)])
      .then(([s, groups]) => {
        if (cancelled) return;
        setSession(s);
        setGroupsById(groups);
      })
      .catch((e) => {
        if (!cancelled) setBootError(friendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(
    async (groupIds: string[], days: number) => {
      if (!session) return;
      setLoading(true);
      setError(null);
      try {
        const toDate = new Date().toISOString();
        const fromDate = new Date(Date.now() - days * 864e5).toISOString();
        setData(await fetchCollisions({ session, groupIds, fromDate, toDate }));
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    if (!session) return;
    void load(selectedGroupIds, rangeDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedGroupIds, rangeDays]);

  const triage = useCallback(
    async (row: CollisionRow, status: CollisionStatus) => {
      if (!session) return;
      setBusyId(row.id);
      setError(null);
      try {
        await setCollisionTriage({ session, collisionId: row.id, status });
        // Optimistic local update.
        setData((prev) =>
          prev
            ? {
                ...prev,
                rows: prev.rows.map((r) =>
                  r.id === row.id ? { ...r, status } : r
                ),
              }
            : prev
        );
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusyId(null);
      }
    },
    [session]
  );

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      all: rows.length,
      new: rows.filter((r) => r.status === "new").length,
      confirmed: rows.filter((r) => r.status === "confirmed").length,
      dismissed: rows.filter((r) => r.status === "dismissed").length,
    };
  }, [data]);

  const visibleRows = useMemo(() => {
    const rows = data?.rows ?? [];
    switch (statusFilter) {
      case "active":
        return rows.filter((r) => r.status !== "dismissed");
      case "all":
        return rows;
      default:
        return rows.filter((r) => r.status === statusFilter);
    }
  }, [data, statusFilter]);

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>Collision Center</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }
  if (bootError) return <Banner type="error">{bootError}</Banner>;

  const canManage = data?.canManage ?? false;

  return (
    <div>
      <div className="vt-header">
        <h1>Collision Center</h1>
        <div className="vt-headerbtns">
          {canManage && (
            <Button type="secondary" onClick={() => setSourcesOpen(true)}>
              Sources
            </Button>
          )}
          <Button
            type="secondary"
            onClick={() => void load(selectedGroupIds, rangeDays)}
            disabled={loading || !session}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      {sourcesOpen && session && (
        <CollisionSourcesModal
          session={session}
          onClose={() => setSourcesOpen(false)}
          onSaved={() => void load(selectedGroupIds, rangeDays)}
        />
      )}

      <p className="vt-scope-note">
        Detected collisions for camera-equipped vehicles in your scope (Geotab
        Possible &amp; Major Collision). Review footage and triage false
        positives. {data?.rulesUsed?.length ? `Rules: ${data.rulesUsed.join(", ")}.` : ""}
      </p>

      <div className="vt-toolbar">
        <GroupFilterPicker
          groupsById={groupsById}
          initialGroupIds={selectedGroupIds}
          onChange={setSelectedGroupIds}
          onError={(e) => setError(friendlyError(e))}
        />
        <select
          className="vt-input vt-input--narrow"
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Banner type="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {loading && !data && <div className="vt-empty">Loading collisions…</div>}

      {data && (
        <>
          <div className="vt-summary">
            <button
              className={`vt-stat${statusFilter === "active" ? " vt-stat--active" : ""}`}
              onClick={() => setStatusFilter("active")}
            >
              <b>{counts.all - counts.dismissed}</b> active
            </button>
            <button
              className={`vt-stat${statusFilter === "new" ? " vt-stat--active" : ""}`}
              onClick={() => setStatusFilter("new")}
            >
              <b>{counts.new}</b> new
            </button>
            <button
              className={`vt-stat vt-stat--ok${statusFilter === "confirmed" ? " vt-stat--active" : ""}`}
              onClick={() => setStatusFilter("confirmed")}
            >
              <b>{counts.confirmed}</b> confirmed
            </button>
            <button
              className={`vt-stat${statusFilter === "dismissed" ? " vt-stat--active" : ""}`}
              onClick={() => setStatusFilter("dismissed")}
            >
              <b>{counts.dismissed}</b> dismissed
            </button>
            <button
              className={`vt-stat${statusFilter === "all" ? " vt-stat--active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              <b>{counts.all}</b> all
            </button>
          </div>

          <table className="vt-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Time</th>
                <th>Vehicle</th>
                <th>Driver</th>
                <th>Group(s)</th>
                <th>Camera</th>
                <th>Status</th>
                {canManage && <th>Triage</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className={r.status === "dismissed" ? "vt-row-muted" : ""}>
                  <td>
                    <span className={SEVERITY_META[r.severity].cls}>
                      {SEVERITY_META[r.severity].label}
                    </span>
                  </td>
                  <td>{fmtTime(r.time)}</td>
                  <td>{r.vehicleName}</td>
                  <td>{r.driverName ?? "—"}</td>
                  <td>{r.geotabGroups}</td>
                  <td>{r.cameraHardwareId ?? "—"}</td>
                  <td>
                    {r.status === "confirmed"
                      ? "Confirmed"
                      : r.status === "dismissed"
                      ? "Dismissed"
                      : "New"}
                  </td>
                  {canManage && (
                    <td>
                      <div className="vt-triage-actions">
                        {r.status !== "confirmed" && (
                          <button
                            type="button"
                            className="vt-linkbtn"
                            disabled={busyId === r.id}
                            onClick={() => void triage(r, "confirmed")}
                          >
                            Confirm
                          </button>
                        )}
                        {r.status !== "dismissed" ? (
                          <button
                            type="button"
                            className="vt-linkbtn vt-linkbtn--danger"
                            disabled={busyId === r.id}
                            onClick={() => void triage(r, "dismissed")}
                          >
                            Dismiss
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="vt-linkbtn"
                            disabled={busyId === r.id}
                            onClick={() => void triage(r, "new")}
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="vt-table-empty">
                    No collisions in this view.
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
