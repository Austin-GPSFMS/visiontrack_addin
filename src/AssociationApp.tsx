/**
 * Device Association — READ-ONLY report of camera↔vehicle pairing health.
 *
 * For every Geotab device within the user's scope: whether it matched a
 * VisionTrack vehicle (VIN-last-6) and whether that vehicle has a camera.
 * Plus the org's cameras not assigned to any vehicle. Pair/unpair actions
 * are a future phase (with their own security identifier + audit).
 */

import { useCallback, useEffect, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  AssociationRow,
  AssociationsResponse,
  GeotabApi,
  GeotabGroup,
  GeotabSession,
} from "./types";
import { fetchScopedGroups, friendlyError, getSession } from "./api/geotab";
import { fetchAssociations } from "./api/proxy";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { exportAssociations } from "./utils/exportAssociations";

interface AppProps {
  api: GeotabApi | null;
}

const STATUS_META: Record<
  AssociationRow["status"],
  { label: string; cls: string }
> = {
  paired: { label: "Camera paired", cls: "vt-pill vt-pill--ok" },
  no_camera: { label: "No camera on VT vehicle", cls: "vt-pill vt-pill--warn" },
  no_vt_match: { label: "No VisionTrack match", cls: "vt-pill vt-pill--bad" },
  no_vin: { label: "No usable VIN in Geotab", cls: "vt-pill vt-pill--bad" },
};

const CAMERA_MODEL_LABELS: Record<number, string> = {
  // Known VisionTrack deviceModel ids can be added here as they're confirmed.
};

export default function AssociationApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(new Map());
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(["GroupCompanyId"]);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AssociationsResponse | null>(null);
  const [filter, setFilter] = useState<"all" | AssociationRow["status"]>("all");
  const [exporting, setExporting] = useState(false);

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
    async (groupIds: string[]) => {
      if (!session) return;
      setLoading(true);
      setError(null);
      try {
        setData(await fetchAssociations(session, groupIds));
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  // Auto-load once the session is ready, and reload when groups change.
  useEffect(() => {
    if (!session) return;
    void load(selectedGroupIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedGroupIds]);

  const handleExport = useCallback(async () => {
    if (!data || !session) return;
    setExporting(true);
    try {
      const groupNames = selectedGroupIds
        .filter((id) => id !== "GroupCompanyId")
        .map((id) => groupsById.get(id)?.name ?? id)
        .join(", ");
      await exportAssociations(data, {
        database: session.database,
        userName: session.userName,
        groupNames,
      });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }, [data, session, selectedGroupIds, groupsById]);

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>Device Association</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }

  if (bootError) {
    return <Banner type="error">{bootError}</Banner>;
  }

  const rows =
    data?.rows.filter((r) => filter === "all" || r.status === filter) ?? [];

  return (
    <div>
      <div className="vt-header">
        <h1>Device Association</h1>
        <div className="vt-headerbtns">
          <Button
            type="secondary"
            onClick={handleExport}
            disabled={!data || exporting}
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>
          <Button
            type="secondary"
            onClick={() => void load(selectedGroupIds)}
            disabled={loading || !session}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      <p className="vt-scope-note">
        Read-only view of camera↔vehicle pairing health for vehicles within
        your group scope. Matching is on the last 6 of the VIN.
      </p>

      <div className="vt-toolbar">
        <GroupFilterPicker
          groupsById={groupsById}
          initialGroupIds={selectedGroupIds}
          onChange={setSelectedGroupIds}
          onError={(e) => setError(friendlyError(e))}
        />
      </div>

      {error && (
        <Banner type="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {loading && !data && <div className="vt-empty">Loading associations…</div>}

      {data && (
        <>
          <div className="vt-summary">
            <button
              className={`vt-stat${filter === "all" ? " vt-stat--active" : ""}`}
              onClick={() => setFilter("all")}
            >
              <b>{data.summary.scopedDevices}</b> vehicles in scope
            </button>
            <button
              className={`vt-stat vt-stat--ok${filter === "paired" ? " vt-stat--active" : ""}`}
              onClick={() => setFilter("paired")}
            >
              <b>{data.summary.paired}</b> camera paired
            </button>
            <button
              className={`vt-stat vt-stat--warn${filter === "no_camera" ? " vt-stat--active" : ""}`}
              onClick={() => setFilter("no_camera")}
            >
              <b>{data.summary.noCamera}</b> no camera
            </button>
            <button
              className={`vt-stat vt-stat--bad${filter === "no_vt_match" ? " vt-stat--active" : ""}`}
              onClick={() => setFilter("no_vt_match")}
            >
              <b>{data.summary.noVtMatch}</b> no VT match
            </button>
            <button
              className={`vt-stat vt-stat--bad${filter === "no_vin" ? " vt-stat--active" : ""}`}
              onClick={() => setFilter("no_vin")}
            >
              <b>{data.summary.noVin}</b> no VIN
            </button>
          </div>

          <table className="vt-table">
            <thead>
              <tr>
                <th>Geotab vehicle</th>
                <th>Group(s)</th>
                <th>VIN tail</th>
                <th>VT vehicle (VRN)</th>
                <th>Camera</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.geotabDeviceId}>
                  <td>{r.geotabDeviceName}</td>
                  <td>{r.geotabGroups}</td>
                  <td>{r.vinLast6 || "—"}</td>
                  <td>{r.vtVrn ?? "—"}</td>
                  <td>{r.cameraHardwareId ?? "—"}</td>
                  <td>
                    <span className={STATUS_META[r.status].cls}>
                      {STATUS_META[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="vt-table-empty">
                    Nothing matches this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h2 className="vt-subhead">
            Unassigned cameras in the VisionTrack organisation (
            {data.summary.unpairedCameras})
          </h2>
          <p className="vt-scope-note">
            These cameras aren't attached to any VisionTrack vehicle, so they
            produce no vehicle-attributable events. Org-wide list.
          </p>
          {data.unpairedCameras.length > 0 ? (
            <table className="vt-table">
              <thead>
                <tr>
                  <th>Hardware ID</th>
                  <th>Model</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {data.unpairedCameras.map((c) => (
                  <tr key={c.id}>
                    <td>{c.hardwareId ?? c.id}</td>
                    <td>
                      {c.model != null
                        ? CAMERA_MODEL_LABELS[c.model] ?? `Model ${c.model}`
                        : "—"}
                    </td>
                    <td>{c.enabled === false ? "No" : "Yes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="vt-scope-note">None — every camera is assigned.</p>
          )}
        </>
      )}
    </div>
  );
}
