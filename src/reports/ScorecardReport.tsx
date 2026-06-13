/**
 * Safety Scorecard — weighted, distance-normalized safety score per vehicle or
 * driver, combining Geotab exception rules and VisionTrack camera events.
 * Faithful to the customer's Excel model; factors/weights/bands are
 * admin-configurable in-report. Scope-gated.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, Button } from "@geotab/zenith";
import type {
  GeotabRuleOption,
  GeotabSession,
  ScoreFactor,
  ScorecardConfig,
  ScorecardRunResponse,
} from "../types";
import { friendlyError } from "../api/geotab";
import {
  fetchScorecardConfig,
  fetchScorecardRules,
  runScorecard,
  saveScorecardConfig,
} from "../api/proxy";
import { SAFETY_EVENT_ENTRIES, EVENT_TYPE_LABELS } from "../utils/eventTypes";
import { exportScorecard } from "../utils/exportScorecard";

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const CLASS_PILL: Record<string, string> = {
  "Low Risk": "vt-pill vt-pill--ok",
  "Mild Risk": "vt-pill vt-pill--warn",
  "Medium Risk": "vt-pill vt-pill--warn",
  "High Risk": "vt-pill vt-pill--bad",
};

export function ScorecardReport({ session }: { session: GeotabSession }) {
  const [fromDate, setFromDate] = useState(isoDaysAgo(30));
  const [toDate, setToDate] = useState(isoDaysAgo(0));
  const [runBy, setRunBy] = useState<"vehicle" | "driver">("vehicle");
  const [unit, setUnit] = useState<"km" | "miles">("miles");

  const [config, setConfig] = useState<ScorecardConfig | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [rules, setRules] = useState<GeotabRuleOption[]>([]);
  const [result, setResult] = useState<ScorecardRunResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft] = useState<ScorecardConfig | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchScorecardConfig(session)
      .then((r) => {
        setConfig(r.config);
        setCanManage(r.canManage);
      })
      .catch((e) => setError(friendlyError(e)));
    fetchScorecardRules(session)
      .then((r) => setRules(r.rules))
      .catch(() => undefined);
  }, [session]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await runScorecard({
        session,
        fromDate: new Date(fromDate + "T00:00:00").toISOString(),
        toDate: new Date(toDate + "T23:59:59").toISOString(),
        runBy,
        unit,
      });
      setResult(r);
      setConfig(r.config);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [session, fromDate, toDate, runBy, unit]);

  const summary = useMemo(() => {
    if (!result) return null;
    const scored = result.rows.filter((r) => r.totalScore != null);
    const avg = scored.length
      ? Math.round((scored.reduce((s, r) => s + (r.totalScore ?? 0), 0) / scored.length) * 10) / 10
      : null;
    const bands = { "Low Risk": 0, "Mild Risk": 0, "Medium Risk": 0, "High Risk": 0 } as Record<string, number>;
    for (const r of result.rows) if (r.classification in bands) bands[r.classification]++;
    return { avg, bands, count: scored.length };
  }, [result]);

  const handleExport = useCallback(async () => {
    if (!result) return;
    setExporting(true);
    try {
      await exportScorecard(result.rows, result.config, {
        database: session.database,
        runBy: result.runBy,
        unit: result.unit,
        fromIso: new Date(fromDate).toISOString(),
        toIso: new Date(toDate).toISOString(),
        generatedAt: result.generatedAt,
      });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }, [result, session.database, fromDate, toDate]);

  // ---- Config editor ----
  const openConfig = () => {
    setDraft(config ? JSON.parse(JSON.stringify(config)) : null);
    setConfigOpen(true);
    setInfo(null);
    setError(null);
  };
  const draftWeightSum = draft ? draft.factors.reduce((a, f) => a + (f.weight || 0), 0) : 0;

  const saveConfig = useCallback(async () => {
    if (!draft) return;
    if (Math.abs(draftWeightSum - 1) > 0.001) {
      setError(`Weights must total 100% (currently ${Math.round(draftWeightSum * 100)}%).`);
      return;
    }
    try {
      const r = await saveScorecardConfig(session, draft);
      setConfig(r.config);
      setConfigOpen(false);
      setInfo("Scorecard settings saved.");
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [draft, draftWeightSum, session]);

  const addFactor = (f: ScoreFactor) => {
    if (!draft) return;
    if (draft.factors.some((x) => x.kind === f.kind && x.key === f.key)) return;
    setDraft({ ...draft, factors: [...draft.factors, f] });
  };
  const updateFactor = (i: number, patch: Partial<ScoreFactor>) => {
    if (!draft) return;
    const factors = draft.factors.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    setDraft({ ...draft, factors });
  };
  const removeFactor = (i: number) => {
    if (!draft) return;
    setDraft({ ...draft, factors: draft.factors.filter((_, idx) => idx !== i) });
  };

  const factorColumns = config?.factors ?? [];

  return (
    <div>
      <p className="vt-scope-note">
        Weighted safety score per {runBy}, combining Geotab exceptions and
        VisionTrack camera events, normalized per distance. Lower score = higher
        risk.
      </p>

      {error && <Banner type="error" onClose={() => setError(null)}>{error}</Banner>}
      {info && <Banner type="success" onClose={() => setInfo(null)}>{info}</Banner>}

      <div className="vt-toolbar">
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>From</span>
          <input className="vt-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>To</span>
          <input className="vt-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>Run by</span>
          <select className="vt-input" value={runBy} onChange={(e) => setRunBy(e.target.value as "vehicle" | "driver")}>
            <option value="vehicle">Vehicle</option>
            <option value="driver">Driver</option>
          </select>
        </label>
        <label className="vt-field" style={{ marginBottom: 0 }}>
          <span>Units</span>
          <select className="vt-input" value={unit} onChange={(e) => setUnit(e.target.value as "km" | "miles")}>
            <option value="miles">Miles</option>
            <option value="km">Kilometers</option>
          </select>
        </label>
        <div className="vt-spacer" />
        {canManage && (
          <Button type="secondary" onClick={openConfig}>Configure scoring</Button>
        )}
        <Button type="secondary" onClick={handleExport} disabled={!result || exporting}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
        <Button type="primary" onClick={() => void run()} disabled={loading}>
          {loading ? "Running…" : "Run scorecard"}
        </Button>
      </div>

      {configOpen && draft && (
        <div className="vt-rule-editor">
          <h2 className="vt-subhead">Scoring configuration</h2>
          <table className="vt-table">
            <thead>
              <tr><th>Factor</th><th>Source</th><th>Formula</th><th>Weight %</th><th></th></tr>
            </thead>
            <tbody>
              {draft.factors.map((f, i) => (
                <tr key={f.kind + f.key}>
                  <td>{f.label}</td>
                  <td>{f.kind === "camera" ? "Camera event" : "Geotab rule"}</td>
                  <td>
                    <select
                      className="vt-input"
                      value={f.formula}
                      onChange={(e) => updateFactor(i, { formula: e.target.value as ScoreFactor["formula"] })}
                    >
                      <option value="uniform">Per-distance count</option>
                      <option value="speeding">Speeding (% stepped)</option>
                      <option value="seatbelt">Seatbelt (70/30 blend)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="vt-input vt-input--narrow"
                      type="number"
                      min={0}
                      max={100}
                      value={Math.round(f.weight * 100)}
                      onChange={(e) => updateFactor(i, { weight: Math.max(0, Number(e.target.value)) / 100 })}
                    />
                  </td>
                  <td><button className="vt-link vt-link--danger" onClick={() => removeFactor(i)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="vt-hint" style={{ color: Math.abs(draftWeightSum - 1) > 0.001 ? "#c43232" : "#1c7f3e" }}>
            Weights total {Math.round(draftWeightSum * 100)}% (must equal 100%).
          </div>

          <div className="vt-field">
            <span>Add a factor</span>
            <div className="vt-toolbar" style={{ marginBottom: 0 }}>
              <select
                className="vt-input"
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v.startsWith("cam:")) {
                    const key = v.slice(4);
                    addFactor({ kind: "camera", key, label: EVENT_TYPE_LABELS[Number(key)] ?? key, weight: 0, formula: "uniform" });
                  } else if (v.startsWith("rule:")) {
                    const id = v.slice(5);
                    const r = rules.find((x) => x.id === id);
                    addFactor({ kind: "geotab", key: id, label: r?.name ?? id, weight: 0, formula: "uniform" });
                  }
                  e.target.value = "";
                }}
              >
                <option value="">Add factor…</option>
                <optgroup label="Camera events">
                  {SAFETY_EVENT_ENTRIES.map((c) => (
                    <option key={c.id} value={`cam:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Geotab rules">
                  {rules.map((r) => (
                    <option key={r.id} value={`rule:${r.id}`}>{r.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div className="vt-field">
            <span>Risk bands (score thresholds)</span>
            <div className="vt-toolbar" style={{ marginBottom: 0 }}>
              {(["low", "mild", "medium"] as const).map((b) => (
                <label key={b} className="vt-field" style={{ marginBottom: 0 }}>
                  <span>{b[0].toUpperCase() + b.slice(1)} ≥</span>
                  <input
                    className="vt-input vt-input--narrow"
                    type="number"
                    value={draft.bands[b]}
                    onChange={(e) => setDraft({ ...draft, bands: { ...draft.bands, [b]: Number(e.target.value) } })}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="vt-editor-actions">
            <button className="vt-btn vt-btn--primary" onClick={saveConfig}>Save settings</button>
            <button className="vt-btn" onClick={() => setConfigOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading && !result && <div className="vt-empty">Running scorecard… (pulling exceptions, trips, and camera events)</div>}

      {result && summary && (
        <>
          <div className="vt-summary">
            <div className="vt-stat"><b>{summary.avg ?? "—"}</b> avg score</div>
            <div className="vt-stat vt-stat--ok"><b>{summary.bands["Low Risk"]}</b> low risk</div>
            <div className="vt-stat vt-stat--warn"><b>{summary.bands["Mild Risk"] + summary.bands["Medium Risk"]}</b> mild/medium</div>
            <div className="vt-stat vt-stat--bad"><b>{summary.bands["High Risk"]}</b> high risk</div>
          </div>

          <table className="vt-table">
            <thead>
              <tr>
                <th>{result.runBy === "driver" ? "Driver" : "Vehicle"}</th>
                <th>Group(s)</th>
                <th>Distance ({result.unit})</th>
                <th>Score</th>
                <th>Classification</th>
                {factorColumns.map((f) => <th key={f.key}>{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.group}</td>
                  <td>{r.distance}</td>
                  <td><strong>{r.totalScore ?? "—"}</strong></td>
                  <td><span className={CLASS_PILL[r.classification] ?? "vt-pill"}>{r.classification}</span></td>
                  {factorColumns.map((f) => {
                    const fs = r.factors.find((x) => x.key === f.key);
                    return (
                      <td key={f.key}>
                        {fs ? `${fs.count} (${fs.subScore == null ? "—" : Math.round(fs.subScore)})` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {result.rows.length === 0 && (
                <tr><td colSpan={5 + factorColumns.length} className="vt-table-empty">No data for this window/scope.</td></tr>
              )}
            </tbody>
          </table>
          <p className="vt-hint">Each factor cell shows: occurrences (sub-score). Run {new Date(result.generatedAt).toLocaleString()}.</p>
        </>
      )}
    </div>
  );
}
