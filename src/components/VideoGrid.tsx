/**
 * VisionTrack-portal-style video card grid.
 *
 * Each card lazy-loads its event's media through the proxy (which re-checks
 * group scope per request). Cards show the thumbnail, clip duration, event
 * type, vehicle, and trigger time; clicking opens a modal that plays the mp4
 * directly from VisionTrack's pre-signed URL — bytes never touch the proxy.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeotabSession, VtEvent, VtMedia } from "../types";
import { fetchEventMedia } from "../api/proxy";

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
  ev,
  media,
  onClose,
}: {
  ev: VtEvent;
  media: VtMedia[];
  onClose: () => void;
}) {
  const videos = useMemo(
    () => media.filter((m) => m.mediaType === MEDIA_VIDEO),
    [media]
  );
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const v = videos[active];
  const title = (ev.eventTypeLabels ?? []).join(", ") || "Event video";

  return (
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div className="vt-modal" onClick={(e) => e.stopPropagation()}>
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
        {v ? (
          <video key={v.id} src={v.uri} controls autoPlay className="vt-modal-video" />
        ) : (
          <div className="vt-card-thumb-empty">No video available.</div>
        )}
        {videos.length > 1 && (
          <div className="vt-modal-channels">
            {videos.map((m, i) => (
              <button
                key={m.id}
                className={`vt-chan${i === active ? " vt-chan--active" : ""}`}
                onClick={() => setActive(i)}
              >
                {m.channelLabel ?? `Channel ${m.channel ?? i}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface VideoGridProps {
  session: GeotabSession;
  events: VtEvent[];
}

export function VideoGrid({ session, events }: VideoGridProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [playing, setPlaying] = useState<{ ev: VtEvent; media: VtMedia[] } | null>(
    null
  );

  const visible = events.slice(0, shown);

  if (events.length === 0) {
    return (
      <div className="vt-card-thumb-empty" style={{ padding: 32 }}>
        No events for the selected filters and date range.
      </div>
    );
  }

  return (
    <>
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
      {shown < events.length && (
        <div className="vt-grid-more">
          <button onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show more ({events.length - shown} remaining)
          </button>
        </div>
      )}
      {playing && (
        <VideoModal
          ev={playing.ev}
          media={playing.media}
          onClose={() => setPlaying(null)}
        />
      )}
    </>
  );
}
