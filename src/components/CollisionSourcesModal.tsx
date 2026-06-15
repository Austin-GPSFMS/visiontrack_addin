/**
 * Admin modal for choosing which Geotab rules feed the Collision Center.
 * Collision-named rules are listed first; the default (when never configured)
 * is Major + any custom collision rule, with Possible/Minor off.
 */

import { useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type { CollisionRuleOption, GeotabSession } from "../types";
import { fetchCollisionConfig, saveCollisionConfig } from "../api/proxy";
import { friendlyError } from "../api/geotab";

export function CollisionSourcesModal({
  session,
  onClose,
  onSaved,
}: {
  session: GeotabSession;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<CollisionRuleOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCollisionConfig(session)
      .then((cfg) => {
        if (cancelled) return;
        setRules(cfg.availableRules);
        setSelected(new Set(cfg.selectedRuleIds));
      })
      .catch((e) => !cancelled && setLoadErr(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [session]);

  const visible = useMemo(() => {
    if (!rules) return [];
    const query = q.trim().toLowerCase();
    return rules.filter((r) => {
      if (!showAll && !r.isCollisionNamed && !selected.has(r.id)) return false;
      return !query || r.name.toLowerCase().includes(query);
    });
  }, [rules, q, showAll, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      await saveCollisionConfig(session, [...selected]);
      onSaved();
      onClose();
    } catch (e) {
      setSaveErr(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vt-modal-backdrop" onClick={onClose}>
      <div className="vt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vt-header">
          <h2>Collision sources</h2>
          <button className="vt-link" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <p className="vt-scope-note">
          Choose which Geotab rules feed this database's Collision Center. Only
          collisions on camera-equipped vehicles in scope appear, whatever you
          pick. Default is Major Collision; turn on Possible Collision only if
          you want it (it fires more often).
        </p>

        {loadErr && <Banner type="error">{loadErr}</Banner>}
        {!rules && !loadErr && <div className="vt-empty">Loading rules…</div>}

        {rules && (
          <>
            <div className="vt-toolbar">
              <input
                className="vt-input"
                placeholder="Search rules…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <label className="vt-checkrow">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                Show all rules (not just collision)
              </label>
            </div>

            <div className="vt-rulelist">
              {visible.map((r) => (
                <label key={r.id} className="vt-checkrow">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                  <span>{r.name}</span>
                  {r.severity && (
                    <span className="vt-muted"> ({r.severity})</span>
                  )}
                </label>
              ))}
              {visible.length === 0 && (
                <div className="vt-map-empty">No rules match.</div>
              )}
            </div>

            {saveErr && (
              <Banner type="error" onClose={() => setSaveErr(null)}>
                {saveErr}
              </Banner>
            )}

            <div className="vt-modal-actions">
              <Button type="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : `Save (${selected.size} selected)`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
