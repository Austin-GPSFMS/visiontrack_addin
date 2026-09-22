/**
 * Custom video requests view.
 *
 * Requests are filtered to one vehicle (or all), grouped by the footage date
 * (newest day first), and rendered as compact thumbnail cards in the same
 * style as the Dashboard event grid. Clicking a ready card pops the clip(s)
 * out into the synced multi-camera modal with the GPS trip map. Polls every
 * 20s while any request is still pending.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { GeotabSession, ScopedVehicle, TrackPoint, VideoRequest, VtMedia } from "../types";
import {
  downloadRequestComposite,
  fetchEventTrack,
  fetchRequestCompositeStatus,
  fetchVideoRequests,
  startRequestComposite,
} from "../api/proxy";
import type { CompositeStatus } from "../api/proxy";
import { friendlyError } from "../api/geotab";
import { VehicleSelect } from "./VehicleSelect";

// Leaflet ships as its own chunk; only fetched when a clip modal opens.
const TripMap = lazy(() => import("./TripMap"));

const MEDIA_VIDEO = 3;
/** Seconds of GPS lead-in shown before the clip's first frame, for context. */
const TRACK_LEADIN_SEC = 20;

const STATE_LABELS: Record<number, { text: string; cls: string }> = {
  0: { text: "Queued", cls: "vt-pill vt-pill--warn" },
  1: { text: "Sent to camera", cls: "vt-pill vt-pill--warn" },
  2: { text: "Uploading", cls: "vt-pill vt-pill--warn" },
  3: { text: "Ready", cls: "vt-pill vt-pill--ok" },
  4: { text: "Cancelled", cls: "vt-pill vt-pill--bad" },
  5: { text: "Failed", cls: "vt-pill vt-pill--bad" },
  6: { text: "Inconclusive", cls: "vt-pill vt-pill--bad" },
  7: { text: "Unavailable", cls: "vt-pill vt-pill--bad" },
};

function stateOf(r: VideoRequest) {
  return r.state != null ? STATE_LABELS[r.state] ?? STATE_LABELS[0] : STATE_LABELS[0];
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/** Local-calendar-day key (YYYY-MM-DD) for grouping. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(key: string): string {
  if (key === "unknown") return "Unknown date";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const long = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (dayKey(today.toISOString()) === key) return `Today — ${long}`;
  if (dayKey(yesterday.toISOString()) === key) return `Yesterday — ${long}`;
  return long;
}

function videosOf(r: VideoRequest): VtMedia[] {
  return (r.media ?? []).filter((m) => m.mediaType === MEDIA_VIDEO);
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function RequestCard({ r, onOpen }: { r: VideoRequest; onOpen: (r: VideoRequest) => void }) {
  const st = stateOf(r);
  const videos = videosOf(r);
  const playable = videos.length > 0;
  const title = r.vehicleLabel || r.hardwareId;

  return (
    <div
      className={`vt-card${playable ? " vt-card--playable" : ""}`}
      onClick={() => playable && onOpen(r)}
      role={playable ? "button" : undefined}
      tabIndex={playable ? 0 : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && playable) onOpen(r);
      }}
    >
      <div className="vt-card-thumb">
        {playable ? (
          // First frame of the primary camera as the poster. The fragment
          // only affects the browser's seek; it is not sent to VisionTrack.
          <video
            className="vt-card-thumbvideo"
            src={`${videos[0].uri}#t=0.5`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
          />
        ) : (
          <div className="vt-card-thumb-empty">
            {r.state != null && r.state < 3 ? `${st.text}…` : st.text}
          </div>
        )}
        <span className="vt-card-cams">
          {r.channels.length} cam{r.channels.length === 1 ? "" : "s"}
        </span>
        <span className="vt-card-duration">{fmtDuration(r.duration)}</span>
        {playable && <span className="vt-card-play">▶</span>}
      </div>
      <div className="vt-card-body">
        <div className="vt-card-title" title={title}>
          {title}
        </div>
        <div className="vt-card-meta">{fmtClock(r.startIso)}</div>
        <div className="vt-card-meta vt-card-meta--dim vt-card-meta--row">
          <span>requested {fmt(r.createdAt)}</span>
          <span className={st.cls}>{st.text}</span>
        </div>
        {r.error && (
          <div className="vt-card-meta" style={{ color: "#c43232" }}>
            {r.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pop-out player
// ---------------------------------------------------------------------------

function RequestClipModal({
  session,
  r,
  onClose,
}: {
  session: GeotabSession;
  r: VideoRequest;
  onClose: () => void;
}) {
  const videos = useMemo(() => videosOf(r), [r]);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const clipStartMs = useMemo(() => {
    const f = videos.find((v) => v.firstFrameDateTime)?.firstFrameDateTime;
    return f ? new Date(f).getTime() : new Date(r.startIso).getTime();
  }, [videos, r.startIso]);

  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);

  // "Download all views": one stitched MP4 built by the proxy. The proxy
  // pre-builds these as requests turn Ready, so this is usually instant; when
  // it isn't, we queue the build and poll its progress rather than holding
  // one long HTTP request open.
  const [dlBusy, setDlBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [dlStatus, setDlStatus] = useState<CompositeStatus | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (videos.length === 0) return;
    fetchRequestCompositeStatus({ session, requestId: r.id })
      .then((st) => !cancelled.current && setDlStatus(st))
      .catch(() => undefined);
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  const saveBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = r.startIso.slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `${(r.vehicleLabel || r.hardwareId).replace(/[^\w.-]+/g, "_")}_${stamp}_multiview.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    setDlBusy(true);
    setDlErr(null);
    try {
      let st = await startRequestComposite({ session, requestId: r.id });
      setDlStatus(st);
      while (st.state !== "ready" && st.state !== "failed") {
        await new Promise((res) => setTimeout(res, 2000));
        if (cancelled.current) return;
        st = await fetchRequestCompositeStatus({ session, requestId: r.id });
        setDlStatus(st);
      }
      if (st.state === "failed") throw new Error(st.error ?? "Build failed.");
      saveBlob(await downloadRequestComposite({ session, requestId: r.id }));
    } catch (e) {
      setDlErr(String((e as Error)?.message ?? e));
    } finally {
      if (!cancelled.current) setDlBusy(false);
    }
  };

  const dlLabel = (() => {
    if (!dlBusy) return dlStatus?.state === "ready" ? "Download all views ✓" : "Download all views";
    switch (dlStatus?.state) {
      case "queued":
        return dlStatus.position > 0 ? `Queued (${dlStatus.position} ahead)…` : "Queued…";
      case "downloading":
        return "Fetching clips…";
      case "encoding":
        return `Stitching… ${dlStatus.pct}%`;
      case "ready":
        return "Downloading…";
      default:
        return "Starting…";
    }
  })();

  // GPS breadcrumbs for the requested window (+ lead-in).
  useEffect(() => {
    const lastFrame = videos.find((v) => v.lastFrameDateTime)?.lastFrameDateTime;
    const toMs = lastFrame ? new Date(lastFrame).getTime() : clipStartMs + r.duration * 1000;
    let cancelled = false;
    fetchEventTrack({
      session,
      hardwareId: r.hardwareId,
      fromDate: new Date(clipStartMs - TRACK_LEADIN_SEC * 1000).toISOString(),
      toDate: new Date(toMs + 2000).toISOString(),
    })
      .then((res) => !cancelled && setTrack(res.points))
      .catch(() => !cancelled && setTrack([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep multi-channel clips loosely in sync (same approach as the Dashboard modal).
  const syncing = useRef(false);
  const syncFrom = (src: HTMLVideoElement, action: "play" | "pause" | "seek") => {
    if (syncing.current) return;
    syncing.current = true;
    for (const v of videoRefs.current) {
      if (!v || v === src) continue;
      if (action === "play") void v.play().catch(() => undefined);
      if (action === "pause") v.pause();
      if (action === "seek" && Math.abs(v.currentTime - src.currentTime) > 0.3) {
        v.currentTime = src.currentTime;
      }
    }
    syncing.current = false;
  };

  const st = stateOf(r);

  // Grid shape: 1 → 1 col, 2 → 2 cols, 4 → 2x2, otherwise 3 cols. Cap each
  // video's height so every row fits on a laptop screen without scrolling.
  const cols = videos.length <= 2 ? Math.max(videos.length, 1) : videos.length === 4 ? 2 : 3;
  const rows = Math.ceil(videos.length / cols);
  // Percent of the container height each video may take (see .vt-modal--fit).
  const vidFrac = rows > 1 ? Math.floor(62 / rows) : 52;

  return (
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div
        className={`vt-modal vt-modal--fit${videos.length > 1 ? " vt-modal--wide" : ""}`}
        style={{ "--vt-vidfrac": vidFrac } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vt-modal-head">
          <div>
            <div className="vt-modal-title">{r.vehicleLabel || r.hardwareId}</div>
            <div className="vt-modal-sub">
              {fmt(r.startIso)} · {r.duration}s · {r.channels.length} camera(s) · requested{" "}
              {fmt(r.createdAt)} <span className={st.cls}>{st.text}</span>
            </div>
          </div>
          <div className="vt-modal-headbtns">
            {videos.length > 0 && (
              <button
                className="vt-btn vt-btn--primary"
                onClick={downloadAll}
                disabled={dlBusy}
                title="Stitch every camera into one synced multi-view MP4"
              >
                {dlLabel}
              </button>
            )}
            <button className="vt-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        {dlBusy && dlStatus?.state !== "ready" && (
          <div className="vt-hint" style={{ marginBottom: 8 }}>
            Combining {videos.length} camera{videos.length === 1 ? "" : "s"} into one synced video
            on the server. You can keep watching here; the download starts automatically when it's
            done.
            {dlStatus?.state === "encoding" && (
              <span className="vt-progress" aria-hidden>
                <span className="vt-progress-bar" style={{ width: `${dlStatus.pct}%` }} />
              </span>
            )}
          </div>
        )}
        {dlErr && (
          <div className="vt-hint" style={{ color: "#c43232", marginBottom: 8 }}>
            {dlErr}
          </div>
        )}

        {videos.length === 0 ? (
          <div className="vt-card-thumb-empty">No video available.</div>
        ) : (
          <div className={`vt-modal-videos vt-modal-videos--${cols}`}>
            {videos.map((m, i) => (
              <div key={m.id} className="vt-modal-videocell">
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={m.uri}
                  controls
                  autoPlay
                  className="vt-modal-video"
                  onPlay={(e) => syncFrom(e.currentTarget, "play")}
                  onPause={(e) => syncFrom(e.currentTarget, "pause")}
                  onSeeked={(e) => syncFrom(e.currentTarget, "seek")}
                  onTimeUpdate={
                    i === 0 ? (e) => setPlayheadMs(e.currentTarget.currentTime * 1000) : undefined
                  }
                />
                <div className="vt-modal-chanlabel">
                  {m.channelLabel ?? `Channel ${m.channel ?? i}`}
                </div>
              </div>
            ))}
          </div>
        )}

        {track && track.length > 0 && (
          <div className="vt-modal-map">
            <Suspense fallback={<div className="vt-map-empty">Loading map…</div>}>
              <TripMap points={track} clipStartMs={clipStartMs} playheadMs={playheadMs} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function RequestsList({
  session,
  vehicles,
  initialVehicleHardwareId = "",
}: {
  session: GeotabSession;
  /** Scoped vehicles for the filter picker (same list as the Dashboard toolbar). */
  vehicles: ScopedVehicle[];
  /** Pre-select the vehicle the user had chosen on the Dashboard. */
  initialVehicleHardwareId?: string;
}) {
  const [requests, setRequests] = useState<VideoRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vehicleHardwareId, setVehicleHardwareId] = useState(initialVehicleHardwareId);
  const [open, setOpen] = useState<VideoRequest | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchVideoRequests(session);
      setRequests(r.requests);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while anything is still pending.
  useEffect(() => {
    const pending = requests.some((r) => r.state == null || r.state < 3);
    if (timer.current) window.clearInterval(timer.current);
    if (pending) {
      timer.current = window.setInterval(() => void load(), 20000);
    }
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [requests, load]);

  // Keep the open modal pointed at the freshest copy of its request (state/media).
  useEffect(() => {
    if (!open) return;
    const fresh = requests.find((r) => r.id === open.id);
    if (fresh && fresh !== open) setOpen(fresh);
  }, [requests, open]);

  const filtered = useMemo(
    () => (vehicleHardwareId ? requests.filter((r) => r.hardwareId === vehicleHardwareId) : requests),
    [requests, vehicleHardwareId]
  );

  // Group by footage date, newest day first; newest clip first within a day.
  const groups = useMemo(() => {
    const byDay = new Map<string, VideoRequest[]>();
    for (const r of filtered) {
      const k = dayKey(r.startIso);
      const arr = byDay.get(k);
      if (arr) arr.push(r);
      else byDay.set(k, [r]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([key, items]) => ({
        key,
        label: dayLabel(key),
        items: items.sort((a, b) => (a.startIso < b.startIso ? 1 : a.startIso > b.startIso ? -1 : 0)),
      }));
  }, [filtered]);

  const pendingCount = filtered.filter((r) => r.state == null || r.state < 3).length;
  const selectedVehicle = vehicles.find((v) => v.hardwareId === vehicleHardwareId);

  if (loading) return <div className="vt-empty">Loading requests…</div>;

  return (
    <div>
      <div className="vt-reqtoolbar">
        <VehicleSelect
          vehicles={vehicles}
          value={vehicleHardwareId}
          onChange={setVehicleHardwareId}
          placeholder="Vehicle: All"
        />
        <span className="vt-scope-note" style={{ margin: 0 }}>
          {filtered.length} request{filtered.length === 1 ? "" : "s"}
          {selectedVehicle ? ` for ${selectedVehicle.geotabDeviceName}` : ""}
          {pendingCount > 0 ? ` · ${pendingCount} pending (auto-refreshing)` : ""}
        </span>
        <button
          className="vt-btn"
          style={{ marginLeft: "auto" }}
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="vt-scope-note" style={{ color: "#c43232" }}>{error}</div>}

      {filtered.length === 0 ? (
        <div className="vt-empty">
          {requests.length === 0
            ? 'No video requests yet. Use "Request video" to pull footage on demand.'
            : "No video requests for this vehicle."}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="vt-reqgroup">
            <div className="vt-reqgroup-head">
              <h3>{g.label}</h3>
              <span className="vt-reqgroup-count">
                {g.items.length} request{g.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="vt-grid vt-grid--compact">
              {g.items.map((r) => (
                <RequestCard key={r.id} r={r} onOpen={setOpen} />
              ))}
            </div>
          </section>
        ))
      )}

      {open && <RequestClipModal session={session} r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
