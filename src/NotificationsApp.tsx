/**
 * Camera Rules — toggle VisionTrack camera events on/off and set who gets
 * emailed. Each event type is already named, so there's no "create a rule"
 * step: every VT safety event is a row with an On/Off toggle; turning one on
 * configures recipients (+ optional group scope + cooldown).
 *
 * Under the hood each enabled event type is one rule in the proxy
 * (rule.eventTypes = [thatType], rule.name = the event label). Delivery is the
 * proxy's own SMTP — Geotab won't provision VisionTrack diagnostics, so these
 * never become native Geotab rules. Alerts link to the Dashboard clip.
 */

import { useCallback, useEffect, useState } from "react";
import { Banner } from "@geotab/zenith";
import type {
  CameraRule,
  GeotabApi,
  GeotabGroup,
  GeotabSession,
} from "./types";
import { fetchScopedGroups, friendlyError, getSession } from "./api/geotab";
import { deleteRule, fetchRules, saveRule } from "./api/proxy";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { EVENT_TYPE_LABELS } from "./utils/eventTypes";

interface AppProps {
  api: GeotabApi | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_COOLDOWN = 30;

/** VisionTrack event types grouped for scannability (ids from the VT enum). */
const CATEGORIES: Array<{ label: string; types: number[] }> = [
  {
    label: "Driver State Monitoring",
    types: [27, 29, 20, 18, 48, 50, 19, 21, 44],
  },
  {
    label: "Collision Avoidance (ADAS)",
    types: [23, 28, 22, 43, 45, 30, 41, 37, 38, 39, 40, 31, 33, 34, 35, 36, 46, 49],
  },
  {
    label: "Driving Behaviour",
    types: [2, 3, 4, 6, 5, 47, 26],
  },
  {
    label: "Other",
    types: [7, 42, 24, 25],
  },
];

interface RowDraft {
  recipients: string[];
  groupIds: string[];
  cooldownMinutes: number;
}

export default function CameraRulesApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(new Map());
  const [bootError, setBootError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [emailOk, setEmailOk] = useState(true);
  const [busy, setBusy] = useState(false);

  // rule per event type (eventTypes is always a single id in this model)
  const [ruleByType, setRuleByType] = useState<Map<number, CameraRule>>(new Map());

  // which event-type row is expanded for editing, and its working draft
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [recipientInput, setRecipientInput] = useState("");

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    Promise.all([getSession(api), fetchScopedGroups(api)])
      .then(([s, g]) => {
        if (cancelled) return;
        setSession(s);
        setGroupsById(g);
      })
      .catch((e) => !cancelled && setBootError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const resp = await fetchRules(session);
      const m = new Map<number, CameraRule>();
      for (const r of resp.rules) {
        const t = r.eventTypes[0];
        if (t != null) m.set(t, r);
      }
      setRuleByType(m);
      setEmailOk(resp.emailConfigured);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [session]);

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const groupSummary = useCallback(
    (ids: string[]) =>
      ids.length === 0
        ? "All vehicles in scope"
        : ids.map((id) => groupsById.get(id)?.name ?? id).join(", "),
    [groupsById]
  );

  // ---- Persist helpers (one rule per event type) ----

  const persistRule = useCallback(
    async (eventType: number, fields: RowDraft, enabled: boolean) => {
      if (!session) return;
      const existing = ruleByType.get(eventType);
      await saveRule(session, {
        id: existing?.id,
        name: EVENT_TYPE_LABELS[eventType] ?? `Event ${eventType}`,
        eventTypes: [eventType],
        groupIds: fields.groupIds,
        recipients: fields.recipients,
        enabled,
        cooldownMinutes: fields.cooldownMinutes,
      });
      await load();
    },
    [session, ruleByType, load]
  );

  const openEditor = (eventType: number) => {
    const r = ruleByType.get(eventType);
    setDraft({
      recipients: r ? [...r.recipients] : [],
      groupIds: r ? [...r.groupIds] : [],
      cooldownMinutes: r ? r.cooldownMinutes : DEFAULT_COOLDOWN,
    });
    setRecipientInput("");
    setEditing(eventType);
    setInfo(null);
    setError(null);
  };

  const handleToggle = useCallback(
    async (eventType: number) => {
      const r = ruleByType.get(eventType);
      if (!r) {
        // No config yet — open the editor so they can add recipients.
        openEditor(eventType);
        return;
      }
      setBusy(true);
      try {
        await persistRule(
          eventType,
          {
            recipients: r.recipients,
            groupIds: r.groupIds,
            cooldownMinutes: r.cooldownMinutes,
          },
          !r.enabled
        );
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
    [ruleByType, persistRule]
  );

  const addRecipients = (raw: string) => {
    if (!draft) return;
    const parts = raw.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = new Set(draft.recipients);
    let bad = "";
    for (const p of parts) {
      if (EMAIL_RE.test(p)) next.add(p);
      else bad = p;
    }
    setDraft({ ...draft, recipients: [...next] });
    setRecipientInput(bad);
  };

  const saveEditor = useCallback(async () => {
    if (editing == null || !draft) return;
    let recipients = draft.recipients;
    const pending = recipientInput.trim();
    if (pending && EMAIL_RE.test(pending)) recipients = [...recipients, pending];
    if (recipients.length === 0) {
      setError("Add at least one recipient email to enable this alert.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await persistRule(editing, { ...draft, recipients }, true);
      setInfo(`${EVENT_TYPE_LABELS[editing]} alerts saved.`);
      setEditing(null);
      setDraft(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [editing, draft, recipientInput, persistRule]);

  const handleRemove = useCallback(
    async (eventType: number) => {
      if (!session) return;
      const r = ruleByType.get(eventType);
      if (!r) return;
      setBusy(true);
      try {
        await deleteRule(session, r.id);
        await load();
        if (editing === eventType) {
          setEditing(null);
          setDraft(null);
        }
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
    [session, ruleByType, load, editing]
  );

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>Camera Rules</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }
  if (bootError) return <Banner type="error">{bootError}</Banner>;

  const renderRow = (eventType: number) => {
    const r = ruleByType.get(eventType);
    const on = Boolean(r?.enabled);
    const isEditing = editing === eventType;
    const label = EVENT_TYPE_LABELS[eventType] ?? `Event ${eventType}`;

    return (
      <div key={eventType} className="vt-rulerow">
        <div className="vt-rulerow-main">
          <div
            className={`vt-seg${on ? " vt-seg--on" : ""}`}
            role="group"
            aria-label={`${label} alerts`}
          >
            <button
              className={`vt-seg-btn${on ? " vt-seg-btn--active" : ""}`}
              onClick={() => !on && void handleToggle(eventType)}
              disabled={busy}
            >
              On
            </button>
            <button
              className={`vt-seg-btn${!on ? " vt-seg-btn--active-off" : ""}`}
              onClick={() => on && void handleToggle(eventType)}
              disabled={busy}
            >
              Off
            </button>
          </div>

          <div className="vt-rulerow-text">
            <div className="vt-rulerow-name">{label}</div>
            <div className="vt-rulerow-sub">
              {r && r.recipients.length > 0
                ? `${r.recipients.join(", ")} · ${groupSummary(r.groupIds)} · ${r.cooldownMinutes}m cooldown`
                : "Not configured — turn on to add recipients."}
            </div>
          </div>

          <div className="vt-rulerow-actions">
            <button className="vt-link" onClick={() => openEditor(eventType)}>
              {r ? "Edit" : "Configure"}
            </button>
            {r && (
              <button
                className="vt-link vt-link--danger"
                onClick={() => void handleRemove(eventType)}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {isEditing && draft && (
          <div className="vt-rulerow-editor">
            <div className="vt-field">
              <span>Recipient emails</span>
              <div className="vt-chips">
                {draft.recipients.map((rcp) => (
                  <span key={rcp} className="vt-chip">
                    {rcp}
                    <button
                      type="button"
                      className="vt-chip-x"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          recipients: draft.recipients.filter((x) => x !== rcp),
                        })
                      }
                      aria-label={`Remove ${rcp}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <input
                className="vt-input"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === " ") {
                    e.preventDefault();
                    addRecipients(recipientInput);
                  }
                }}
                onBlur={() => recipientInput.trim() && addRecipients(recipientInput)}
                placeholder="Type an email, press Enter"
              />
            </div>

            <div className="vt-field">
              <span>Vehicle groups</span>
              <GroupFilterPicker
                groupsById={groupsById}
                initialGroupIds={draft.groupIds.length ? draft.groupIds : ["GroupCompanyId"]}
                onChange={(ids) =>
                  setDraft({ ...draft, groupIds: ids.filter((id) => id !== "GroupCompanyId") })
                }
                onError={(e) => setError(friendlyError(e))}
              />
              <small className="vt-hint">
                Leave as Company to alert on all vehicles in scope.
              </small>
            </div>

            <label className="vt-field">
              <span>Cooldown per vehicle (minutes)</span>
              <input
                className="vt-input vt-input--narrow"
                type="number"
                min={0}
                value={draft.cooldownMinutes}
                onChange={(e) =>
                  setDraft({ ...draft, cooldownMinutes: Number(e.target.value) })
                }
              />
            </label>

            <div className="vt-editor-actions">
              <button className="vt-btn vt-btn--primary" onClick={saveEditor} disabled={busy}>
                {busy ? "Saving…" : "Save & enable"}
              </button>
              <button
                className="vt-btn"
                onClick={() => {
                  setEditing(null);
                  setDraft(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="vt-header">
        <h1>Camera Rules</h1>
      </div>

      <p className="vt-scope-note">
        Turn on the VisionTrack camera events you want email alerts for, and
        choose who gets notified. Each alert fires at most once per vehicle per
        cooldown window and links to the clip in the Dashboard.
      </p>

      {!emailOk && (
        <Banner type="warning">
          Email delivery isn't configured on the GPSFMS proxy yet — toggles will
          save but won't send until SMTP is set up.
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

      {CATEGORIES.map((cat) => (
        <div key={cat.label} className="vt-rulecat">
          <div className="vt-rulecat-head">{cat.label}</div>
          {cat.types.map(renderRow)}
        </div>
      ))}
    </div>
  );
}
