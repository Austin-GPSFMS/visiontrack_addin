/**
 * Camera Rules — toggle VisionTrack camera events on/off (admin only,
 * company-wide) and choose who gets emailed. Targeting is entirely by
 * recipient: individual Geotab users (each auto-limited to their own group
 * access), external/shared emails, and reusable Distribution Lists managed at
 * the top of the page. Delivery is the proxy's own SMTP; alerts link to the
 * Dashboard clip. Each enabled event type is one rule in the proxy.
 */

import { useCallback, useEffect, useState } from "react";
import { Banner } from "@geotab/zenith";
import type {
  CameraRule,
  DistributionList,
  GeotabApi,
  GeotabSession,
  PickerUser,
} from "./types";
import { friendlyError, getSession } from "./api/geotab";
import {
  deleteDistList,
  deleteRule,
  fetchRuleUsers,
  fetchRules,
  saveDistList,
  saveRule,
} from "./api/proxy";
import { EVENT_TYPE_LABELS } from "./utils/eventTypes";

interface AppProps {
  api: GeotabApi | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_COOLDOWN = 30;

const CATEGORIES: Array<{ label: string; types: number[] }> = [
  { label: "Driver State Monitoring", types: [27, 29, 20, 18, 48, 50, 19, 21, 44] },
  {
    label: "Collision Avoidance (ADAS)",
    types: [23, 28, 22, 43, 45, 30, 41, 37, 38, 39, 40, 31, 33, 34, 35, 36, 46, 49],
  },
  { label: "Driving Behaviour", types: [2, 3, 4, 6, 5, 47, 26] },
  { label: "Other", types: [7, 42, 24, 25] },
];

/** Reusable email picker: searchable Geotab-user dropdown + chips. The menu
 *  opens on focus (showing users to choose from) and filters as you type.
 *  When `allowExternal` is false, only known account users can be added —
 *  arbitrary emails are rejected (they'd be unscoped). */
function RecipientPicker({
  users,
  value,
  onChange,
  allowExternal,
}: {
  users: PickerUser[];
  value: string[];
  onChange: (next: string[]) => void;
  allowExternal: boolean;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");

  const q = input.trim().toLowerCase();
  const available = users.filter((u) => !value.includes(u.email));
  const matches = (q
    ? available.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      )
    : available
  ).slice(0, 10);
  const moreCount = (q
    ? available.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      ).length
    : available.length) - matches.length;

  const addUser = (email: string) => {
    if (!value.includes(email)) onChange([...value, email]);
    setInput("");
    setHint("");
  };

  const commitTyped = () => {
    const e = input.trim();
    if (!e) return;
    // Prefer an exact/first user match.
    const exact = available.find((u) => u.email.toLowerCase() === e.toLowerCase());
    if (exact) return addUser(exact.email);
    if (matches[0]) return addUser(matches[0].email);
    // No user match — only allow if external addresses are permitted.
    if (EMAIL_RE.test(e)) {
      if (allowExternal) {
        if (!value.includes(e)) onChange([...value, e]);
        setInput("");
        setHint("");
      } else {
        setHint("Only users in this account can be added.");
      }
    }
  };

  return (
    <>
      <div className="vt-chips">
        {value.map((rcp) => {
          const u = users.find((x) => x.email === rcp);
          return (
            <span key={rcp} className="vt-chip" title={rcp}>
              {u ? u.name : rcp}
              <button
                type="button"
                className="vt-chip-x"
                onClick={() => onChange(value.filter((x) => x !== rcp))}
                aria-label={`Remove ${rcp}`}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
      <div className="vt-typeahead">
        <input
          className="vt-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setHint("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyped();
            }
          }}
          onBlur={() => {
            // Delay so a menu click registers before closing.
            setTimeout(() => setOpen(false), 150);
          }}
          placeholder={allowExternal ? "Search users, or type an email…" : "Search users…"}
        />
        {open && matches.length > 0 && (
          <div className="vt-typeahead-menu">
            {matches.map((u) => (
              <button
                key={u.email}
                type="button"
                className="vt-typeahead-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addUser(u.email)}
              >
                <span className="vt-ta-name">{u.name}</span>
                <span className="vt-ta-email">{u.email}</span>
              </button>
            ))}
            {moreCount > 0 && (
              <div className="vt-typeahead-more">
                +{moreCount} more — keep typing to narrow
              </div>
            )}
          </div>
        )}
      </div>
      {hint && <small className="vt-hint" style={{ color: "#c43232" }}>{hint}</small>}
    </>
  );
}

interface RowDraft {
  recipients: string[];
  listIds: string[];
  cooldownMinutes: number;
}

export default function CameraRulesApp({ api }: AppProps) {
  const [session, setSession] = useState<GeotabSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [emailOk, setEmailOk] = useState(true);
  const [canManageRules, setCanManageRules] = useState(false);
  const [canManageRecipients, setCanManageRecipients] = useState(false);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<PickerUser[]>([]);

  const [ruleByType, setRuleByType] = useState<Map<number, CameraRule>>(new Map());
  const [distLists, setDistLists] = useState<DistributionList[]>([]);

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<RowDraft | null>(null);

  // Distribution-list manager state.
  const [listEditing, setListEditing] = useState<string | "new" | null>(null);
  const [listDraft, setListDraft] = useState<{ name: string; members: string[] }>(
    { name: "", members: [] }
  );

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    getSession(api)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        fetchRuleUsers(s)
          .then((r) => !cancelled && setUsers(r.users))
          .catch(() => undefined);
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
      setDistLists(resp.distLists);
      setEmailOk(resp.emailConfigured);
      setCanManageRules(resp.canManageRules);
      setCanManageRecipients(resp.canManageRecipients);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [session]);

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const listName = useCallback(
    (id: string) => distLists.find((l) => l.id === id)?.name ?? "list",
    [distLists]
  );

  // ---- Rules ----

  const persistRule = useCallback(
    async (eventType: number, fields: RowDraft, enabled: boolean) => {
      if (!session) return;
      const existing = ruleByType.get(eventType);
      await saveRule(session, {
        id: existing?.id,
        name: EVENT_TYPE_LABELS[eventType] ?? `Event ${eventType}`,
        eventTypes: [eventType],
        groupIds: [],
        recipients: fields.recipients,
        listIds: fields.listIds,
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
      listIds: r ? [...r.listIds] : [],
      cooldownMinutes: r ? r.cooldownMinutes : DEFAULT_COOLDOWN,
    });
    setEditing(eventType);
    setInfo(null);
    setError(null);
  };

  const handleToggle = useCallback(
    async (eventType: number) => {
      const r = ruleByType.get(eventType);
      if (!r) {
        openEditor(eventType);
        return;
      }
      // Optimistic flip so the toggle responds instantly.
      const next = new Map(ruleByType);
      next.set(eventType, { ...r, enabled: !r.enabled });
      setRuleByType(next);
      setBusy(true);
      try {
        await persistRule(
          eventType,
          { recipients: r.recipients, listIds: r.listIds, cooldownMinutes: r.cooldownMinutes },
          !r.enabled
        );
      } catch (e) {
        setError(friendlyError(e));
        await load(); // revert to server truth on failure
      } finally {
        setBusy(false);
      }
    },
    [ruleByType, persistRule, load]
  );

  const saveEditor = useCallback(async () => {
    if (editing == null || !draft) return;
    if (draft.recipients.length === 0 && draft.listIds.length === 0) {
      setError("Add at least one recipient or distribution list to enable this alert.");
      return;
    }
    // Don't change the on/off state from the editor — preserve it for existing
    // rules (recipient-only managers can't flip it); a brand-new config enables.
    const existing = ruleByType.get(editing);
    const enabled = existing ? existing.enabled : true;
    setBusy(true);
    setError(null);
    try {
      await persistRule(editing, draft, enabled);
      setInfo(`${EVENT_TYPE_LABELS[editing]} alerts saved.`);
      setEditing(null);
      setDraft(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [editing, draft, persistRule]);

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

  // ---- Distribution lists ----

  const openListEditor = (id: string | "new") => {
    if (id === "new") setListDraft({ name: "", members: [] });
    else {
      const l = distLists.find((x) => x.id === id);
      setListDraft({ name: l?.name ?? "", members: l ? [...l.members] : [] });
    }
    setListEditing(id);
    setInfo(null);
    setError(null);
  };

  const saveListEditor = useCallback(async () => {
    if (!session || listEditing == null) return;
    if (!listDraft.name.trim()) {
      setError("Distribution list needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveDistList(session, {
        id: listEditing === "new" ? undefined : listEditing,
        name: listDraft.name.trim(),
        members: listDraft.members,
      });
      setListEditing(null);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [session, listEditing, listDraft, load]);

  const handleListDelete = useCallback(
    async (id: string) => {
      if (!session) return;
      setBusy(true);
      try {
        await deleteDistList(session, id);
        await load();
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
    [session, load]
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

  const recipientSummary = (r: CameraRule): string => {
    const names = r.recipients.map((e) => users.find((u) => u.email === e)?.name ?? e);
    const lists = r.listIds.map((id) => `${listName(id)} (list)`);
    return [...lists, ...names].join(", ");
  };

  const renderRow = (eventType: number) => {
    const r = ruleByType.get(eventType);
    const on = Boolean(r?.enabled);
    const isEditing = editing === eventType;
    const label = EVENT_TYPE_LABELS[eventType] ?? `Event ${eventType}`;

    return (
      <div key={eventType} className="vt-rulerow">
        <div className="vt-rulerow-main">
          <div className="vt-seg" role="group" aria-label={`${label} alerts`}>
            <button
              className={`vt-seg-btn${on ? " vt-seg-btn--active" : ""}`}
              onClick={() => !on && void handleToggle(eventType)}
              disabled={busy || !canManageRules}
            >
              On
            </button>
            <button
              className={`vt-seg-btn${!on ? " vt-seg-btn--active-off" : ""}`}
              onClick={() => on && void handleToggle(eventType)}
              disabled={busy || !canManageRules}
            >
              Off
            </button>
          </div>

          <div className="vt-rulerow-text">
            <div className="vt-rulerow-name">{label}</div>
            <div className="vt-rulerow-sub">
              {r && (r.recipients.length > 0 || r.listIds.length > 0)
                ? `${recipientSummary(r)} · ${r.cooldownMinutes}m cooldown`
                : canManageRules
                  ? "Not configured — turn on to add recipients."
                  : "Not configured."}
            </div>
          </div>

          {canManageRecipients && (
            <div className="vt-rulerow-actions">
              <button className="vt-link" onClick={() => openEditor(eventType)}>
                {r ? "Edit" : "Configure"}
              </button>
              {r && canManageRules && (
                <button
                  className="vt-link vt-link--danger"
                  onClick={() => void handleRemove(eventType)}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>

        {isEditing && draft && (
          <div className="vt-rulerow-editor">
            <div className="vt-field">
              <span>Recipients</span>
              <RecipientPicker
                users={users}
                value={draft.recipients}
                onChange={(recipients) => setDraft({ ...draft, recipients })}
                allowExternal={canManageRules}
              />
              <small className="vt-hint">
                {canManageRules
                  ? "Geotab users are auto-limited to vehicles in their own group access; any other email gets all of this event's alerts."
                  : "Geotab users are auto-limited to vehicles in their own group access."}
              </small>
            </div>

            {distLists.length > 0 && (
              <div className="vt-field">
                <span>Distribution lists</span>
                <div className="vt-listchecks">
                  {distLists.map((l) => (
                    <label key={l.id} className="vt-checkrow">
                      <input
                        type="checkbox"
                        checked={draft.listIds.includes(l.id)}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            listIds: draft.listIds.includes(l.id)
                              ? draft.listIds.filter((x) => x !== l.id)
                              : [...draft.listIds, l.id],
                          })
                        }
                      />
                      {l.name} <span className="vt-muted">({l.members.length})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

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
                {busy ? "Saving…" : "Save"}
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
        choose who gets notified. Alerts fire at most once per vehicle per
        cooldown window and link to the clip in the Dashboard.
      </p>

      {!canManageRules && !canManageRecipients && (
        <Banner type="info">
          You can view which camera-event alerts are active. Managing them
          requires a GPSFMS camera clearance.
        </Banner>
      )}
      {!canManageRules && canManageRecipients && (
        <Banner type="info">
          You can manage recipients for active alerts (within your group
          access). Turning alerts on/off requires the "GPSFMS - Manage Camera
          Rules" clearance.
        </Banner>
      )}
      {(canManageRules || canManageRecipients) && !emailOk && (
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

      {/* ---- Distribution lists ---- */}
      {canManageRecipients && (
        <div className="vt-rulecat">
          <div className="vt-rulecat-head vt-rulecat-head--action">
            <span>Distribution Lists</span>
            {listEditing == null && (
              <button className="vt-link" onClick={() => openListEditor("new")}>
                + New list
              </button>
            )}
          </div>

          {distLists.length === 0 && listEditing == null && (
            <div className="vt-rulerow">
              <div className="vt-rulerow-main vt-muted">
                No distribution lists yet. Create one to reuse a group of
                recipients across rules.
              </div>
            </div>
          )}

          {distLists.map((l) =>
            listEditing === l.id ? null : (
              <div key={l.id} className="vt-rulerow">
                <div className="vt-rulerow-main">
                  <div className="vt-rulerow-text">
                    <div className="vt-rulerow-name">{l.name}</div>
                    <div className="vt-rulerow-sub">
                      {l.members.length} member{l.members.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="vt-rulerow-actions">
                    <button className="vt-link" onClick={() => openListEditor(l.id)}>
                      Edit
                    </button>
                    <button
                      className="vt-link vt-link--danger"
                      onClick={() => void handleListDelete(l.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          )}

          {listEditing != null && (
            <div className="vt-rulerow">
              <div className="vt-rulerow-editor" style={{ width: "100%" }}>
                <label className="vt-field">
                  <span>List name</span>
                  <input
                    className="vt-input"
                    value={listDraft.name}
                    onChange={(e) => setListDraft({ ...listDraft, name: e.target.value })}
                    placeholder="e.g. Safety team"
                  />
                </label>
                <div className="vt-field">
                  <span>Members</span>
                  <RecipientPicker
                    users={users}
                    value={listDraft.members}
                    onChange={(members) => setListDraft({ ...listDraft, members })}
                    allowExternal={canManageRules}
                  />
                </div>
                <div className="vt-editor-actions">
                  <button
                    className="vt-btn vt-btn--primary"
                    onClick={saveListEditor}
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Save list"}
                  </button>
                  <button
                    className="vt-btn"
                    onClick={() => setListEditing(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- Event-type rules ---- */}
      {CATEGORIES.map((cat) => (
        <div key={cat.label} className="vt-rulecat">
          <div className="vt-rulecat-head">{cat.label}</div>
          {cat.types.map(renderRow)}
        </div>
      ))}
    </div>
  );
}
