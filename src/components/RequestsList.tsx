/**
 * Custom video requests list: shows each submitted request with live status,
 * and the clip inline once the camera has uploaded it. Polls every 20s while
 * any request is still pending.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeotabSession, VideoRequest } from "../types";
import { fetchVideoRequests } from "../api/proxy";
import { friendlyError } from "../api/geotab";

const MEDIA_VIDEO = 3;

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

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function RequestsList({ session }: { session: GeotabSession }) {
  const [requests, setRequests] = useState<VideoRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  if (loading) return <div className="vt-empty">Loading requests…</div>;

  return (
    <div>
      {error && <div className="vt-scope-note" style={{ color: "#c43232" }}>{error}</div>}
      {requests.length === 0 ? (
        <div className="vt-empty">
          No video requests yet. Use "Request video" to pull footage on demand.
        </div>
      ) : (
        <div className="vt-reqlist">
          {requests.map((r) => {
            const st = r.state != null ? STATE_LABELS[r.state] : STATE_LABELS[0];
            const videos = (r.media ?? []).filter((m) => m.mediaType === MEDIA_VIDEO);
            return (
              <div key={r.id} className="vt-reqrow">
                <div className="vt-reqrow-head">
                  <div>
                    <div className="vt-rulerow-name">{r.vehicleLabel ?? r.hardwareId}</div>
                    <div className="vt-rulerow-sub">
                      {fmt(r.startIso)} · {r.duration}s · {r.channels.length} camera(s)
                      {" · requested "}
                      {fmt(r.createdAt)}
                    </div>
                  </div>
                  <span className={st.cls}>{st.text}</span>
                </div>
                {videos.length > 0 && (
                  <div className={`vt-modal-videos vt-modal-videos--${Math.min(videos.length, 2)}`}>
                    {videos.map((m) => (
                      <div key={m.id} className="vt-modal-videocell">
                        <video src={m.uri} controls className="vt-modal-video" />
                        <div className="vt-modal-chanlabel">
                          {m.channelLabel ?? `Channel ${m.channel ?? ""}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
