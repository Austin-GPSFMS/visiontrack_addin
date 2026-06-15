/**
 * Collision detail — review footage before deciding, then triage.
 *
 * Loads VisionTrack events on the collision's camera within ±2 min of the
 * collision time and plays whatever the camera captured. Speed/accelerometer
 * graphs, trip map, raw log and "Download all accident data" come next; this
 * first cut covers the footage review + Confirm/Dismiss the user asked for.
 */

import { useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  CollisionMediaClip,
  CollisionRow,
  CollisionStatus,
  GeotabSession,
  VtMedia,
} from "../types";
import { fetchCollisionMedia } from "../api/proxy";
import { friendlyError } from "../api/geotab";
import { EVENT_TYPE_LABELS } from "../utils/eventTypes";

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

  const totalVideos = useMemo(
    () => (clips ?? []).reduce((n, c) => n + videoOf(c.media).length, 0),
    [clips]
  );

  return (
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div className="vt-modal vt-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="vt-header">
          <h2>
            Collision — {collision.vehicleName}
          </h2>
          <button className="vt-link" onClick={onClose}>
            ✕ Close
          </button>
        </div>

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
            camera may not have captured an event at that exact moment — a manual
            footage request for this window is coming in the next update.
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
    </div>
  );
}
