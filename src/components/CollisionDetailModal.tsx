/**
 * Collision detail — review footage before deciding, then triage.
 *
 * Loads VisionTrack events on the collision's camera within ±2 min of the
 * collision time and plays whatever the camera captured. Speed/accelerometer
 * graphs, trip map, raw log and "Download all accident data" come next; this
 * first cut covers the footage review + Confirm/Dismiss the user asked for.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Banner, Button } from "@geotab/zenith";
import type {
  CollisionDetailResponse,
  CollisionMediaClip,
  CollisionRow,
  CollisionStatus,
  GeotabSession,
  VtMedia,
} from "../types";
import {
  downloadCollisionData,
  fetchCollisionDetail,
  fetchCollisionMedia,
  fetchDeviceChannels,
  fetchVideoRequests,
  requestVideo,
} from "../api/proxy";
import type { VideoRequest } from "../types";
import { friendlyError } from "../api/geotab";
import { EVENT_TYPE_LABELS } from "../utils/eventTypes";
import { SpeedChart } from "./SpeedChart";

const TripMap = lazy(() => import("./TripMap"));

const KPH_TO_MPH = 0.621371;
const WINDOW_OPTIONS = [
  { label: "±30 sec", sec: 30 },
  { label: "±1 min", sec: 60 },
  { label: "±2 min", sec: 120 },
  { label: "±5 min", sec: 300 },
];

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function videoOf(media: VtMedia[]): VtMedia[] {
  return media.filter((m) => m.mediaType === 3);
}
function stillOf(media: VtMedia[]): VtMedia[] {
  return media.filter((m) => m.mediaType === 4 || m.mediaType === 5);
}

export function CollisionDetailModal({
  session,
  collision,
  canManage,
  onClose,
  onTriaged,
}: {
  session: GeotabSession;
  collision: CollisionRow;
  canManage: boolean;
  onClose: () => void;
  onTriaged: (status: CollisionStatus) => void;
}) {
  const [clips, setClips] = useState<CollisionMediaClip[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowSec, setWindowSec] = useState(30);
  const [detail, setDetail] = useState<CollisionDetailResponse | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const [reqState, setReqState] = useState<VideoRequest | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);

  const collisionMs = useMemo(() => new Date(collision.time).getTime(), [collision.time]);

  const handleRequestFootage = async () => {
    if (!collision.cameraHardwareId) return;
    setRequesting(true);
    setReqErr(null);
    try {
      const { channels } = await fetchDeviceChannels({
        session,
        hardwareId: collision.cameraHardwareId,
        vehicleId: collision.vtVehicleId,
      });
      const chans = channels.map((c) => c.channel);
      if (chans.length === 0) throw new Error("Couldn't determine the camera's channels to request.");
      // Centered on the collision, capped at the 180s clip limit.
      const duration = Math.min(windowSec * 2, 180);
      const startDateTime = new Date(collisionMs - (duration / 2) * 1000).toISOString();
      const { request } = await requestVideo({
        session,
        hardwareId: collision.cameraHardwareId,
        vehicleId: collision.vtVehicleId,
        startDateTime,
        duration,
        channels: chans,
      });
      setReqState(request);
    } catch (e) {
      setReqErr(friendlyError(e));
    } finally {
      setRequesting(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadErr(null);
    try {
      const blob = await downloadCollisionData({
        session,
        geotabDeviceId: collision.geotabDeviceId,
        time: collision.time,
        hardwareId: collision.cameraHardwareId,
        vehicleId: collision.vtVehicleId,
        beforeSec: windowSec,
        afterSec: windowSec,
        vehicleName: collision.vehicleName,
        ruleName: collision.ruleName,
        severity: collision.severity,
        groups: collision.geotabGroups,
        driverName: collision.driverName,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date(collision.time).toISOString().slice(0, 10);
      a.href = url;
      a.download = `collision-${collision.vehicleName}-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadErr(friendlyError(e));
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!collision.cameraHardwareId) {
      setLoading(false);
      setLoadErr("This collision has no paired camera, so there's no footage to load.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchCollisionMedia({
      session,
      hardwareId: collision.cameraHardwareId,
      vehicleId: collision.vtVehicleId,
      time: collision.time,
      windowSec: 120,
    })
      .then((r) => !cancelled && setClips(r.clips))
      .catch((e) => !cancelled && setLoadErr(friendlyError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, collision]);

  // Telematics detail (GPS track + ignition) over the chosen window.
  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    setDetailErr(null);
    fetchCollisionDetail({
      session,
      geotabDeviceId: collision.geotabDeviceId,
      time: collision.time,
      beforeSec: windowSec,
      afterSec: windowSec,
    })
      .then((r) => !cancelled && setDetail(r))
      .catch((e) => !cancelled && setDetailErr(friendlyError(e)))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, collision, windowSec]);

  // Poll the footage request until the camera finishes uploading it.
  useEffect(() => {
    if (!reqState) return;
    const isTerminal = (st?: number) => st === 3 || st === 4 || st === 5 || st === 7;
    if (isTerminal(reqState.state)) return;
    const id = reqState.id;
    const timer = setInterval(async () => {
      try {
        const { requests } = await fetchVideoRequests(session);
        const found = requests.find((r) => r.id === id);
        if (found) {
          setReqState(found);
          if (isTerminal(found.state)) clearInterval(timer);
        }
      } catch {
        /* ignore a transient poll error */
      }
    }, 12000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqState?.id]);

  const totalVideos = useMemo(
    () => (clips ?? []).reduce((n, c) => n + videoOf(c.media).length, 0),
    [clips]
  );

  const reqStatusText = (st?: number): string => {
    switch (st) {
      case 3:
        return "Footage ready";
      case 4:
        return "Request cancelled";
      case 5:
        return "Request failed — the camera couldn't provide this clip";
      case 7:
        return "Footage unavailable for this window";
      default:
        return "Requested — the camera is uploading the clip (this can take a few minutes)…";
    }
  };

  const fromMs = collisionMs - windowSec * 1000;
  const toMs = collisionMs + windowSec * 1000;

  // Ignition state at a given time = last known value at/before it.
  const ignitionAt = (ms: number): string => {
    const ig = detail?.ignition ?? [];
    let state: string = "—";
    for (const p of ig) {
      if (new Date(p.t).getTime() <= ms) state = p.on ? "On" : "Off";
      else break;
    }
    return state;
  };

  return createPortal(
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div className="vt-modal vt-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="vt-header">
          <h2>
            Collision — {collision.vehicleName}
          </h2>
          <div className="vt-headerbtns">
            <Button type="primary" onClick={handleDownload} disabled={downloading}>
              {downloading ? "Preparing…" : "⬇ Download all accident data"}
            </Button>
            <button className="vt-link" onClick={onClose}>
              ✕ Close
            </button>
          </div>
        </div>

        {downloadErr && (
          <Banner type="error" onClose={() => setDownloadErr(null)}>
            {downloadErr}
          </Banner>
        )}

        <div className="vt-collision-meta">
          <span><b>Severity:</b> {collision.severity}</span>
          <span><b>Rule:</b> {collision.ruleName}</span>
          <span><b>Time:</b> {fmt(collision.time)}</span>
          {collision.driverName && <span><b>Driver:</b> {collision.driverName}</span>}
          <span><b>Camera:</b> {collision.cameraHardwareId ?? "—"}</span>
          <span><b>Group(s):</b> {collision.geotabGroups}</span>
        </div>

        {loadErr && <Banner type="error">{loadErr}</Banner>}
        {loading && <div className="vt-empty">Loading footage near the collision…</div>}

        {!loading && clips && clips.length === 0 && !loadErr && (
          <Banner type="info">
            No camera footage found within ±2 minutes of this collision. The
            camera may not have captured an event at that exact moment — use
            "Request footage for this window" below to pull the clip directly
            from the camera.
          </Banner>
        )}

        {!loading && clips && clips.length > 0 && (
          <>
            <p className="vt-scope-note">
              {totalVideos} video clip(s) from {clips.length} camera event(s)
              near the collision, closest first.
            </p>
            {clips.map((c) => {
              const vids = videoOf(c.media);
              const stills = stillOf(c.media);
              const types = c.eventTypes
                .map((t) => EVENT_TYPE_LABELS[t] ?? `Type ${t}`)
                .join(", ");
              return (
                <div key={c.eventId} className="vt-collision-clip">
                  <div className="vt-collision-clip-head">
                    {fmt(c.triggerTime)}
                    {types ? ` — ${types}` : ""}
                  </div>
                  <div
                    className={`vt-modal-videos${
                      vids.length === 1 ? " vt-modal-videos--1" : " vt-modal-videos--2"
                    }`}
                  >
                    {vids.map((m) => (
                      <div key={m.id} className="vt-modal-videocell">
                        {m.channelLabel && (
                          <div className="vt-modal-chanlabel">{m.channelLabel}</div>
                        )}
                        <video src={m.uri} controls preload="metadata" className="vt-modal-video" />
                      </div>
                    ))}
                    {vids.length === 0 &&
                      stills.map((m) => (
                        <div key={m.id} className="vt-modal-videocell">
                          {m.channelLabel && (
                            <div className="vt-modal-chanlabel">{m.channelLabel}</div>
                          )}
                          <img src={m.uri} alt="Camera still" className="vt-modal-video" />
                        </div>
                      ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ---- Request footage (camera uploads the clip on demand) ---- */}
        {collision.cameraHardwareId && (
          <div className="vt-collision-request">
            <Button
              type="secondary"
              onClick={handleRequestFootage}
              disabled={
                requesting ||
                (!!reqState && ![3, 4, 5, 7].includes(reqState.state ?? -1))
              }
            >
              {requesting
                ? "Requesting…"
                : reqState
                ? "Request again"
                : "Request footage for this window"}
            </Button>
            {reqErr && (
              <Banner type="error" onClose={() => setReqErr(null)}>
                {reqErr}
              </Banner>
            )}
            {reqState && (
              <span className="vt-scope-note" style={{ marginLeft: 10 }}>
                {reqStatusText(reqState.state)}
              </span>
            )}
            {reqState?.media && videoOf(reqState.media).length > 0 && (
              <div
                className={`vt-modal-videos${
                  videoOf(reqState.media).length === 1
                    ? " vt-modal-videos--1"
                    : " vt-modal-videos--2"
                }`}
              >
                {videoOf(reqState.media).map((m) => (
                  <div key={m.id} className="vt-modal-videocell">
                    {m.channelLabel && (
                      <div className="vt-modal-chanlabel">{m.channelLabel}</div>
                    )}
                    <video src={m.uri} controls preload="metadata" className="vt-modal-video" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Telematics: window, speed graph, map, raw log ---- */}
        <div className="vt-collision-section">
          <div className="vt-collision-section-head">
            <h3>Telematics</h3>
            <select
              className="vt-input vt-input--narrow"
              value={windowSec}
              onChange={(e) => setWindowSec(Number(e.target.value))}
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.sec} value={o.sec}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {detailErr && <Banner type="error">{detailErr}</Banner>}
          {detailLoading && <div className="vt-empty">Loading telematics…</div>}

          {detail && !detailLoading && (
            <>
              <SpeedChart
                points={detail.track}
                collisionMs={collisionMs}
                fromMs={fromMs}
                toMs={toMs}
              />

              <div className="vt-collision-map">
                {detail.track.length > 0 ? (
                  <Suspense fallback={<div className="vt-map-empty">Loading map…</div>}>
                    <TripMap
                      points={detail.track}
                      clipStartMs={fromMs}
                      playheadMs={collisionMs - fromMs}
                    />
                  </Suspense>
                ) : (
                  <div className="vt-map-empty">
                    No GPS movement in this window (likely stationary).
                  </div>
                )}
              </div>

              <details className="vt-collision-log">
                <summary>Raw log ({detail.track.length} points)</summary>
                <div className="vt-collision-log-scroll">
                  <table className="vt-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Speed (mph)</th>
                        <th>Ignition</th>
                        <th>Latitude</th>
                        <th>Longitude</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.track.map((p, i) => (
                        <tr key={i}>
                          <td>{new Date(p.t).toLocaleTimeString()}</td>
                          <td>{((p.speedKph ?? 0) * KPH_TO_MPH).toFixed(1)}</td>
                          <td>{ignitionAt(new Date(p.t).getTime())}</td>
                          <td>{p.lat.toFixed(5)}</td>
                          <td>{p.lon.toFixed(5)}</td>
                        </tr>
                      ))}
                      {detail.track.length === 0 && (
                        <tr>
                          <td colSpan={5} className="vt-table-empty">
                            No log points in this window.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>

        {canManage && (
          <div className="vt-modal-actions">
            {collision.status !== "dismissed" && (
              <Button
                type="secondary"
                onClick={() => {
                  onTriaged("dismissed");
                  onClose();
                }}
              >
                Dismiss (false positive)
              </Button>
            )}
            {collision.status !== "confirmed" && (
              <Button
                type="primary"
                onClick={() => {
                  onTriaged("confirmed");
                  onClose();
                }}
              >
                Confirm collision
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
