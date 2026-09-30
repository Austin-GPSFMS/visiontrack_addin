/**
 * Live camera video (HLS) for one scoped vehicle. Gated by the
 * "GPSFMS - View Live Camera Video" clearance (the proxy enforces it; the
 * Dashboard only shows the button when /api/vehicles says canLiveView).
 *
 * Streams cost the customer cellular data, so the viewer pings the proxy
 * while open and stops the stream on Stop / close / tab hide; the proxy also
 * stops idle streams and enforces a hard cap per session.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import type { DeviceChannel, GeotabSession, ScopedVehicle } from "../types";
import { fetchDeviceChannels, pingLive, startLive, stopLive } from "../api/proxy";
import type { LiveStartResponse } from "../api/proxy";
import { friendlyError } from "../api/geotab";
import { VehicleSelect } from "./VehicleSelect";

type Phase = "idle" | "starting" | "live" | "ended" | "error";

function fmtRemaining(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** One <video> wired to an HLS source via hls.js (native on Safari). */
function LivePlayer({ url, label, muted }: { url: string; label: string; muted: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    setErr(null);

    (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS: native HLS.
        video.src = url;
        await video.play().catch(() => undefined);
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setErr("This browser can't play live HLS video.");
        return;
      }
      const h = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 10,
        enableWorker: true,
      });
      hls = h;
      h.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean; type?: string; details?: string }) => {
        if (!data?.fatal) return;
        if (data.type === "networkError") {
          // Camera may still be spinning the stream up — retry a few times.
          h.startLoad();
          setErr("Waiting for the camera to start streaming…");
        } else if (data.type === "mediaError") {
          h.recoverMediaError();
        } else {
          setErr(`Playback error: ${data.details ?? data.type ?? "unknown"}`);
        }
      });
      h.on(Hls.Events.MANIFEST_PARSED, () => {
        setErr(null);
        void video.play().catch(() => undefined);
      });
      h.loadSource(url);
      h.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);

  return (
    <div className="vt-modal-videocell">
      <video ref={ref} className="vt-modal-video" autoPlay playsInline muted={muted} controls />
      <div className="vt-modal-chanlabel">
        <span className="vt-live-dot" aria-hidden /> {label}
        {err && <div className="vt-hint" style={{ color: "#b06c00" }}>{err}</div>}
      </div>
    </div>
  );
}

export function LiveViewModal({
  session,
  vehicles,
  initialVehicleHardwareId,
  onClose,
}: {
  session: GeotabSession;
  vehicles: ScopedVehicle[];
  initialVehicleHardwareId?: string;
  onClose: () => void;
}) {
  const [hardwareId, setHardwareId] = useState(initialVehicleHardwareId ?? "");
  const vehicle = vehicles.find((v) => v.hardwareId === hardwareId);
  const [channels, setChannels] = useState<DeviceChannel[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [quality, setQuality] = useState<0 | 1>(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [streams, setStreams] = useState<LiveStartResponse["channels"]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const liveHardwareId = useRef<string | null>(null);

  // Channels for the picked vehicle (verified ones pre-selected, like Request Video).
  useEffect(() => {
    if (!hardwareId) {
      setChannels([]);
      setSelected([]);
      return;
    }
    let cancelled = false;
    setLoadingChannels(true);
    fetchDeviceChannels({ session, hardwareId, vehicleId: vehicle?.vehicleId })
      .then((r) => {
        if (cancelled) return;
        setChannels(r.channels);
        const verified = r.channels.filter((c) => c.verified === true);
        const pick = (verified.length > 0 ? verified : r.channels).map((c) => c.channel);
        // Live streams are heavy: default to the first two cameras at most.
        setSelected(pick.slice(0, 2));
      })
      .catch((e) => !cancelled && setError(friendlyError(e)))
      .finally(() => !cancelled && setLoadingChannels(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareId]);

  const stop = useCallback(
    async (opts?: { keepalive?: boolean }) => {
      const hw = liveHardwareId.current;
      liveHardwareId.current = null;
      setStreams([]);
      setRemaining(null);
      setPhase((p) => (p === "live" || p === "starting" ? "ended" : p));
      if (hw) await stopLive({ session, hardwareId: hw }, opts).catch(() => undefined);
    },
    [session]
  );

  const start = async () => {
    setError(null);
    if (!hardwareId) return setError("Pick a vehicle.");
    if (selected.length === 0) return setError("Select at least one camera.");
    setPhase("starting");
    try {
      const r = await startLive({
        session,
        hardwareId,
        vehicleId: vehicle?.vehicleId,
        channels: selected,
        quality,
      });
      liveHardwareId.current = hardwareId;
      setStreams(r.channels);
      setRemaining(r.maxSeconds);
      setPhase("live");
    } catch (e) {
      setPhase("error");
      setError(friendlyError(e));
    }
  };

  // Keepalive + countdown while live; the proxy stops the stream if pings stop.
  useEffect(() => {
    if (phase !== "live" || !liveHardwareId.current) return;
    const hw = liveHardwareId.current;
    const ping = window.setInterval(() => {
      pingLive({ session, hardwareId: hw })
        .then((r) => setRemaining(r.remainingSeconds))
        .catch(() => {
          // 404 = proxy already ended it (idle / max duration).
          liveHardwareId.current = null;
          setStreams([]);
          setPhase("ended");
        });
    }, 30000);
    const tick = window.setInterval(
      () => setRemaining((s) => (s == null ? s : Math.max(0, s - 1))),
      1000
    );
    return () => {
      window.clearInterval(ping);
      window.clearInterval(tick);
    };
  }, [phase, session]);

  // Stop on close/unmount and when the page unloads (keepalive fetch survives
  // the unload). A backgrounded tab keeps pinging, so alt-tabbing is fine.
  useEffect(() => {
    const onHide = () => {
      if (liveHardwareId.current) void stop({ keepalive: true });
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void stop({ keepalive: true });
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

  const labelFor = (ch: number) => channels.find((c) => c.channel === ch)?.label ?? `Channel ${ch}`;
  const cols = streams.length <= 2 ? Math.max(streams.length, 1) : streams.length === 4 ? 2 : 3;
  const rows = Math.ceil(Math.max(streams.length, 1) / cols);
  const vidFrac = rows > 1 ? Math.floor(62 / rows) : 52;
  const title = useMemo(() => (vehicle ? vehicle.geotabDeviceName : "Live view"), [vehicle]);

  return createPortal(
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div
        className={`vt-modal vt-modal--fit${streams.length > 1 ? " vt-modal--wide" : ""}`}
        style={{ "--vt-vidfrac": vidFrac } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vt-modal-head">
          <div>
            <div className="vt-modal-title">
              {phase === "live" && <span className="vt-live-badge">LIVE</span>} {title}
            </div>
            <div className="vt-modal-sub">
              {phase === "live" && remaining != null
                ? `${streams.length} camera${streams.length === 1 ? "" : "s"} · ${quality ? "HD" : "SD"} · auto-stops in ${fmtRemaining(remaining)}`
                : "Live camera video streams over the vehicle's cellular connection."}
            </div>
          </div>
          <div className="vt-modal-headbtns">
            {phase === "live" ? (
              <button className="vt-btn vt-btn--primary" onClick={() => void stop()}>
                Stop
              </button>
            ) : (
              <button
                className="vt-btn vt-btn--primary"
                onClick={start}
                disabled={phase === "starting" || !hardwareId || loadingChannels}
              >
                {phase === "starting" ? "Starting…" : phase === "ended" ? "Start again" : "Start live view"}
              </button>
            )}
            <button className="vt-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {error && <div className="vt-hint" style={{ color: "#c43232", marginBottom: 8 }}>{error}</div>}

        {phase === "live" ? (
          <div className={`vt-modal-videos vt-modal-videos--${cols}`}>
            {streams.map((st, i) => (
              <LivePlayer key={st.channel} url={st.url} label={labelFor(st.channel)} muted={i > 0} />
            ))}
          </div>
        ) : (
          <div className="vt-live-setup">
            <div className="vt-field">
              <span>Vehicle</span>
              <VehicleSelect
                vehicles={vehicles}
                value={hardwareId}
                onChange={setHardwareId}
                allowAll={false}
                placeholder="Select a vehicle…"
              />
            </div>
            <div className="vt-field">
              <span>Cameras</span>
              {!hardwareId ? (
                <small className="vt-hint">Pick a vehicle to load its cameras.</small>
              ) : loadingChannels ? (
                <small className="vt-hint">Loading cameras…</small>
              ) : channels.length === 0 ? (
                <small className="vt-hint">No cameras reported for this vehicle.</small>
              ) : (
                <div className="vt-listchecks">
                  {channels.map((c) => (
                    <label key={c.channel} className="vt-checkrow">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.channel)}
                        onChange={() =>
                          setSelected((prev) =>
                            prev.includes(c.channel)
                              ? prev.filter((x) => x !== c.channel)
                              : [...prev, c.channel]
                          )
                        }
                      />
                      {c.label}
                      {c.verified === true && (
                        <span className="vt-chan-note vt-chan-note--ok">✓ footage seen</span>
                      )}
                      {c.verified === false && <span className="vt-chan-note">no footage seen</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="vt-field">
              <span>Quality</span>
              <div className="vt-listchecks vt-listchecks--row">
                <label className="vt-checkrow">
                  <input type="radio" name="vt-live-q" checked={quality === 0} onChange={() => setQuality(0)} />
                  SD (less data)
                </label>
                <label className="vt-checkrow">
                  <input type="radio" name="vt-live-q" checked={quality === 1} onChange={() => setQuality(1)} />
                  HD
                </label>
              </div>
            </div>
            <small className="vt-hint">
              {phase === "ended"
                ? "The live stream has stopped."
                : "Each camera streams over the vehicle's cellular plan while this window is open. Streams stop automatically when you close this window or after 15 minutes."}
            </small>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
