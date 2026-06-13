/**
 * Camera Rules — self-owned camera-event notifications.
 *
 * A rule = event types + group scope + recipient emails + per-vehicle
 * cooldown. The proxy's ingestion worker matches every VisionTrack event
 * against enabled rules and emails recipients directly (delivery is ours, not
 * Geotab's — Geotab won't provision VisionTrack diagnostics). Emails link
 * back to the Dashboard clip, scope-gated by the recipient's own Geotab access.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  CameraRule,
  GeotabApi,
  GeotabGroup,
  GeotabSession,
  RuleInput,
} from "./types";
import { fetchScopedGroups, friendlyError, getSession } from "./api/geotab";
import { deleteRule, fetchRules, saveRule } from "./api/proxy";
import { GroupFilterPicker } from "./components/GroupFilterPicker";
import { EVENT_TYPE_LABELS, SAFETY_EVENT_ENTRIES } from "./utils/eventTypes";

interface AppProps {
  api: GeotabApi | null;
}

const EVENT_TYPE_ENTRIES = SAFETY_EVENT_ENTRIES;

function emptyDraft(): RuleInput {
  return {
    name: "",
    eventTypes: [],
    groupIds: [],
    recipients: [],
    enabled: true,
    cooldownMinutes: 30,
  };
}

export default function CameraRulesApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, GeotabGroup>>(new Map());
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rules, setRules] = useState<CameraRule[]>([]);
  const [emailOk, setEmailOk] = useState(true);
  const [draft, setDraft] = useState<RuleInput | null>(null);
  const [recipientText, setRecipientText] = useState("");
  const [saving, setSaving] = useState(false);

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
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchRules(session);
      setRules(resp.rules);
      setEmailOk(resp.emailConfigured);
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

  const groupNameList = useCallback(
    (ids: string[]) =>
      ids.length === 0
        ? "All vehicles in scope"
        : ids.map((id) => groupsById.get(id)?.name ?? id).join(", "),
    [groupsById]
  );

  const startNew = () => {
    setDraft(emptyDraft());
    setRecipientText("");
    setInfo(null);
    setError(null);
  };

  const startEdit = (r: CameraRule) => {
    setDraft({
      id: r.id,
      name: r.name,
      eventTypes: r.eventTypes,
      groupIds: r.groupIds,
      recipients: r.recipients,
      enabled: r.enabled,
      cooldownMinutes: r.cooldownMinutes,
    });
    setRecipientText(r.recipients.join(", "));
    setInfo(null);
    setError(null);
  };

  const handleSave = useCallback(async () => {
    if (!session || !draft) return;
    const recipients = recipientText
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      await saveRule(session, { ...draft, recipients });
      setInfo(`Rule "${draft.name}" saved.`);
      setDraft(null);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }, [session, draft, recipientText, load]);

  const handleDelete = useCallback(
    async (r: CameraRule) => {
      if (!session) return;
      try {
        await deleteRule(session, r.id);
        await load();
      } catch (e) {
        setError(friendlyError(e));
      }
    },
    [session, load]
  );

  const toggleType = (id: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      eventTypes: draft.eventTypes.includes(id)
        ? draft.eventTypes.filter((t) => t !== id)
        : [...draft.eventTypes, id],
    });
  };

  const selectedTypeSummary = useMemo(() => {
    if (!draft) return "";
    if (draft.eventTypes.length === 0) return "None selected";
    return `${draft.eventTypes.length} selected`;
  }, [draft]);

  if (!api) {
    return (
      <div className="vt-empty">
        <h1>Camera Rules</h1>
        <p>This page must be opened from within MyGeotab.</p>
      </div>
    );
  }
  if (bootError) return <Banner type="error">{bootError}</Banner>;

  return (
    <div>
      <div className="vt-header">
        <h1>Camera Rules</h1>
        {!draft && (
          <Button type="primary" onClick={startNew} disabled={!session}>
            New rule
          </Button>
        )}
      </div>

      <p className="vt-scope-note">
        Email alerts for VisionTrack camera events. Each rule watches the event
        types you pick, for vehicles in the groups you choose, and emails your
        recipients — at most once per vehicle per cooldown window. Alerts link
        to the clip in the Dashboard.
      </p>

      {!emailOk && (
        <Banner type="warning">
          Email delivery isn't configured on the GPSFMS proxy yet — rules will
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

      {draft && (
        <div className="vt-rule-editor">
          <h2 className="vt-subhead">{draft.id ? "Edit rule" : "New rule"}</h2>

          <label className="vt-field">
            <span>Rule name</span>
            <input
              className="vt-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Mobile phone use — all branches"
            />
          </label>

          <div className="vt-field">
            <span>Event types ({selectedTypeSummary})</span>
            <div className="vt-typegrid">
              {EVENT_TYPE_ENTRIES.map((t) => (
                <label key={t.id} className="vt-checkrow">
                  <input
                    type="checkbox"
                    checked={draft.eventTypes.includes(t.id)}
                    onChange={() => toggleType(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>

          <div className="vt-field">
            <span>Vehicle groups</span>
            <GroupFilterPicker
              groupsById={groupsById}
              initialGroupIds={draft.groupIds.length ? draft.groupIds : ["GroupCompanyId"]}
              onChange={(ids) =>
                setDraft({
                  ...draft,
                  groupIds: ids.filter((id) => id !== "GroupCompanyId"),
                })
              }
              onError={(e) => setError(friendlyError(e))}
            />
            <small className="vt-hint">
              Leave as Company (no specific group) to watch all vehicles in scope.
            </small>
          </div>

          <label className="vt-field">
            <span>Recipient emails</span>
            <input
              className="vt-input"
              value={recipientText}
              onChange={(e) => setRecipientText(e.target.value)}
              placeholder="safety@customer.com, manager@customer.com"
            />
          </label>

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

          <label className="vt-checkrow">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            Enabled
          </label>

          <div className="vt-editor-actions">
            <Button type="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save rule"}
            </Button>
            <Button type="secondary" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!draft && (
        <>
          {loading && rules.length === 0 && <div className="vt-empty">Loading…</div>}
          {!loading && rules.length === 0 && (
            <div className="vt-empty">No rules yet. Click "New rule" to add one.</div>
          )}
          {rules.length > 0 && (
            <table className="vt-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Event types</th>
                  <th>Groups</th>
                  <th>Recipients</th>
                  <th>Cooldown</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>
                      {r.eventTypes
                        .map((t) => EVENT_TYPE_LABELS[t] ?? t)
                        .join(", ")}
                    </td>
                    <td>{groupNameList(r.groupIds)}</td>
                    <td>{r.recipients.join(", ")}</td>
                    <td>{r.cooldownMinutes}m</td>
                    <td>
                      <span
                        className={
                          r.enabled ? "vt-pill vt-pill--ok" : "vt-pill vt-pill--warn"
                        }
                      >
                        {r.enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td className="vt-rowactions">
                      <button className="vt-link" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                      <button
                        className="vt-link vt-link--danger"
                        onClick={() => void handleDelete(r)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
