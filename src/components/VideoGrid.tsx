/**
 * VisionTrack-portal-style video card grid.
 *
 * Each card lazy-loads its event's media through the proxy (which re-checks
 * group scope per request). Cards show the thumbnail, clip duration, event
 * type, vehicle, and trigger time; clicking opens a modal that plays the mp4
 * directly from VisionTrack's pre-signed URL — bytes never touch the proxy.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { GeotabSession, TrackPoint, VtEvent, VtMedia } from "../types";
import { fetchEventMedia, fetchEventTrack } from "../api/proxy";

// Lazy-loaded so Leaflet ships as its own chunk, only fetched when a clip
// modal with a track opens.
const TripMap = lazy(() => import("./TripMap"));

/** Seconds of GPS lead-in shown before the clip's first frame, for context. */
const TRACK_LEADIN_SEC = 20;

const MEDIA_VIDEO = 3;
const MEDIA_PREVIEW = 4;
const MEDIA_THUMBNAIL = 5;

/** How many cards render initially / per "Show more" click. */
const PAGE_SIZE = 24;

// Module-level cache so toggling views doesn't refetch media.
const mediaCache = new Map<string, VtMedia[]>();

function clipSeconds(m: VtMedia): number | null {
  if (!m.firstFrameDateTime || !m.lastFrameDateTime) return null;
  const ms =
    new Date(m.lastFrameDateTime).getTime() -
    new Date(m.firstFrameDateTime).getTime();
  return ms > 0 ? Math.round(ms / 1000) : null;
}

function fmtDuration(s: number | null): string {
  if (s == null) return "";
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface CardMediaState {
  loading: boolean;
  error?: string;
  media: VtMedia[];
}

function useEventMedia(
  session: GeotabSession,
  ev: VtEvent,
  visible: boolean
): CardMediaState {
  const [state, setState] = useState<CardMediaState>(() => {
    const hit = mediaCache.get(ev.id);
    return hit ? { loading: false, media: hit } : { loading: true, media: [] };
  });

  useEffect(() => {
    if (!visible || mediaCache.has(ev.id) || !ev.hardwareId) {
      if (!ev.hardwareId) setState({ loading: false, media: [] });
      return;
    }
    let cancelled = false;
    fetchEventMedia({
      session,
      eventId: ev.id,
      hardwareId: ev.hardwareId,
      vehicleId: ev.vehicleId,
    })
      .then((resp) => {
        mediaCache.set(ev.id, resp.media);
        if (!cancelled) setState({ loading: false, media: resp.media });
      })
      .catch((e) => {
        if (!cancelled)
          setState({ loading: false, media: [], error: String(e?.message ?? e) });
      });
    return () => {
      cancelled = true;
    };
  }, [session, ev.id, ev.hardwareId, visible]);

  return state;
}

function VideoCard({
  session,
  ev,
  onPlay,
}: {
  session: GeotabSession;
  ev: VtEvent;
  onPlay: (ev: VtEvent, media: VtMedia[]) => void;
}) {
  // Only fetch media once the card is actually near the viewport.
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { loading, media, error } = useEventMedia(session, ev, visible);

  const videos = media.filter((m) => m.mediaType === MEDIA_VIDEO);
  const still =
    media.find((m) => m.mediaType === MEDIA_PREVIEW) ??
    media.find((m) => m.mediaType === MEDIA_THUMBNAIL);
  const duration = videos.length > 0 ? clipSeconds(videos[0]) : null;
  const title = (ev.eventTypeLabels ?? []).join(", ") || ev.eventTypes.join(", ");

  return (
    <div
      ref={ref}
      className={`vt-card${videos.length > 0 ? " vt-card--playable" : ""}`}
      onClick={() => videos.length > 0 && onPlay(ev, media)}
      role={videos.length > 0 ? "button" : undefined}
      tabIndex={videos.length > 0 ? 0 : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && videos.length > 0)
          onPlay(ev, media);
      }}
    >
      <div className="vt-card-thumb">
        {still ? (
          <img src={still.uri} alt={title} loading="lazy" />
        ) : (
          <div className="vt-card-thumb-empty">
            {loading ? "Loading…" : error ? "Media unavailable" : "No media"}
          </div>
        )}
        {duration != null && (
          <span className="vt-card-duration">{fmtDuration(duration)}</span>
        )}
        {videos.length > 0 && <span className="vt-card-play">▶</span>}
      </div>
      <div className="vt-card-body">
        <div className="vt-card-title">{title}</div>
        <div className="vt-card-meta">{ev.geotabDeviceName ?? ev.vrn ?? ""}</div>
        <div className="vt-card-meta vt-card-meta--dim">{fmtTime(ev.triggerTime)}</div>
      </div>
    </div>
  );
}

function VideoModal({
  session,
  ev,
  media,
  onClose,
}: {
  session: GeotabSession;
  ev: VtEvent;
  media: VtMedia[];
  onClose: () => void;
}) {
  const videos = useMemo(
    () => media.filter((m) => m.mediaType === MEDIA_VIDEO),
    [media]
  );
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  // Clip start epoch (video currentTime 0) from the first video's frame times.
  const clipStartMs = useMemo(() => {
    const f = videos.find((v) => v.firstFrameDateTime)?.firstFrameDateTime;
    return f ? new Date(f).getTime() : new Date(ev.triggerTime).getTime();
  }, [videos, ev.triggerTime]);

  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);

  // Fetch the GPS track for the clip window (+ lead-in) once.
  useEffect(() => {
    if (!ev.hardwareId) {
      setTrack([]);
      return;
    }
    const lastFrame = videos.find((v) => v.lastFrameDateTime)?.lastFrameDateTime;
    const toMs = lastFrame ? new Date(lastFrame).getTime() : clipStartMs + 15000;
    let cancelled = false;
    fetchEventTrack({
      session,
      hardwareId: ev.hardwareId,
      vehicleId: ev.vehicleId,
      fromDate: new Date(clipStartMs - TRACK_LEADIN_SEC * 1000).toISOString(),
      toDate: new Date(toMs + 2000).toISOString(),
    })
      .then((r) => !cancelled && setTrack(r.points))
      .catch(() => !cancelled && setTrack([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep multi-channel clips loosely in sync: play/pause/seek on one applies
  // to the others.
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

  const title = (ev.eventTypeLabels ?? []).join(", ") || "Event video";

  return (
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div
        className={`vt-modal${videos.length > 1 ? " vt-modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vt-modal-head">
          <div>
            <div className="vt-modal-title">{title}</div>
            <div className="vt-modal-sub">
              {(ev.geotabDeviceName ?? ev.vrn ?? "") + " — " + fmtTime(ev.triggerTime)}
            </div>
          </div>
          <button className="vt-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {videos.length === 0 ? (
          <div className="vt-card-thumb-empty">No video available.</div>
        ) : (
          <div className={`vt-modal-videos vt-modal-videos--${Math.min(videos.length, 2)}`}>
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
                    i === 0
                      ? (e) => setPlayheadMs(e.currentTarget.currentTime * 1000)
                      : undefined
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

export interface VideoGridProps {
  session: GeotabSession;
  events: VtEvent[];
  /** When set (e.g. from a notification email deep link), auto-open this
   *  event's clip once its media loads. */
  autoOpenEventId?: string | null;
}

export function VideoGrid({ session, events, autoOpenEventId }: VideoGridProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [playing, setPlaying] = useState<{ ev: VtEvent; media: VtMedia[] } | null>(
    null
  );
  const [autoOpenError, setAutoOpenError] = useState<string | null>(null);
  const autoOpenedRef = useRef(false);

  // Auto-open the deep-linked event's clip (fetch its media directly).
  useEffect(() => {
    if (!autoOpenEventId || autoOpenedRef.current) return;
    const ev = events.find((e) => e.id === autoOpenEventId);
    if (!ev || !ev.hardwareId) {
      if (events.length > 0) setAutoOpenError("Linked event not in the current view.");
      return;
    }
    autoOpenedRef.current = true;
    fetchEventMedia({
      session,
      eventId: ev.id,
      hardwareId: ev.hardwareId,
      vehicleId: ev.vehicleId,
    })
      .then((resp) => setPlaying({ ev, media: resp.media }))
      .catch((e) => setAutoOpenError(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenEventId, events]);

  // Ensure the deep-linked card is rendered even if far down the list.
  const targetIndex = autoOpenEventId
    ? events.findIndex((e) => e.id === autoOpenEventId)
    : -1;
  const effectiveShown =
    targetIndex >= shown ? Math.max(shown, targetIndex + 1) : shown;
  const visible = events.slice(0, effectiveShown);

  if (events.length === 0) {
    return (
      <div className="vt-card-thumb-empty" style={{ padding: 32 }}>
        No events for the selected filters and date range.
      </div>
    );
  }

  return (
    <>
      {autoOpenError && (
        <div className="vt-scope-note" style={{ color: "#c43232" }}>
          {autoOpenError}
        </div>
      )}
      <div className="vt-grid">
        {visible.map((ev) => (
          <VideoCard
            key={ev.id}
            session={session}
            ev={ev}
            onPlay={(e, m) => setPlaying({ ev: e, media: m })}
          />
        ))}
      </div>
      {effectiveShown < events.length && (
        <div className="vt-grid-more">
          <button onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show more ({events.length - effectiveShown} remaining)
          </button>
        </div>
      )}
      {playing && (
        <VideoModal
          session={session}
          ev={playing.ev}
          media={playing.media}
          onClose={() => setPlaying(null)}
        />
      )}
    </>
  );
}
