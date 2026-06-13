/**
 * Notifications — wire VisionTrack camera events to native Geotab rules.
 *
 * The proxy's ingestion worker injects VT events as StatusData on custom
 * diagnostics ("VT: Mobile Phone Warning", ...). This page shows, per event
 * type: whether the diagnostic exists yet (it appears after the first event
 * of that type is ingested) and which Geotab rules reference it. "Create
 * rule" adds a ready-made rule AS THE CURRENT USER; recipients are then
 * managed in Geotab's own Edit Rule page — Geotab handles all delivery.
 */

import { useCallback, useEffect, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  GeotabApi,
  GeotabSession,
  NotificationItem,
  NotificationsStatusResponse,
} from "./types";
import { friendlyError, getSession } from "./api/geotab";
import { createRule, fetchNotificationsStatus } from "./api/proxy";

interface AppProps {
  api: GeotabApi | null;
}

export default function NotificationsApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [data, setData] = useState<NotificationsStatusResponse | null>(null);
  const [creating, setCreating] = useState<number | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getSession(api)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((e) => {
        if (!cancelled) setBootError(friendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchNotificationsStatus(session));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleCreateRule = useCallback(
    async (item: NotificationItem) => {
      if (!session || !item.diagnosticId) return;
      setCreating(item.eventType);
      setError(null);
      setInfo(null);
      try {
        const resp = await createRule({
          session,
          diagnosticId: item.diagnosticId,
          eventTypeLabel: item.label,
        });
        setInfo(
          `Rule "${resp.ruleName}" created. Open it under Rules & Groups → Rules to add notification recipients.`
        );
        await load();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setCreating(null);
      }
    },
    [session, load]
  );

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>VisionTrack Notifications</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }

  if (bootError) {
    return <Banner type="error">{bootError}</Banner>;
  }

  return (
    <div>
      <div className="vt-header">
        <h1>Notifications</h1>
        <Button type="secondary" onClick={() => void load()} disabled={loading || !session}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <p className="vt-scope-note">
        VisionTrack camera events are injected into this database as engine
        data ("VT: …" diagnostics). Create a rule per event type below, then
        add recipients on Geotab's Edit Rule page — notifications are
        delivered by Geotab itself (email, popup, driver feedback).
      </p>

      {data && !data.ingestionConfigured && (
        <Banner type="warning">
          Event ingestion is not yet configured for this database (no service
          account on the GPSFMS proxy). Contact GPSFMS to enable it — rules
          created here will not fire until ingestion is running.
        </Banner>
      )}

      {error && (
        <Banner type="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}
      {info && (
        <Banner type="success" onClose={() => setInfo(null)}>
          {info}
        </Banner>
      )}

      {loading && !data && <div className="vt-empty">Loading…</div>}

      {data && (
        <table className="vt-table">
          <thead>
            <tr>
              <th>Camera event type</th>
              <th>Data status</th>
              <th>Rules</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.eventType}>
                <td>{item.label}</td>
                <td>
                  {item.diagnosticId ? (
                    <span className="vt-pill vt-pill--ok">Receiving data</span>
                  ) : (
                    <span className="vt-pill vt-pill--warn">
                      No events ingested yet
                    </span>
                  )}
                </td>
                <td>
                  {item.rules.length > 0
                    ? item.rules.map((r) => r.name).join(", ")
                    : "—"}
                </td>
                <td>
                  {item.diagnosticId && item.rules.length === 0 && (
                    <Button
                      type="secondary"
                      onClick={() => void handleCreateRule(item)}
                      disabled={creating !== null}
                    >
                      {creating === item.eventType ? "Creating…" : "Create rule"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
