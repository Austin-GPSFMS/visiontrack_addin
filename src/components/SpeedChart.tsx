/**
 * Lightweight SVG speed chart for the collision detail view — speed (mph) over
 * the before/after window with a vertical marker at the moment of collision.
 * No chart library; just an inline SVG so it stays in the main bundle.
 */

import type { TrackPoint } from "../types";

const KPH_TO_MPH = 0.621371;

export function SpeedChart({
  points,
  collisionMs,
  fromMs,
  toMs,
}: {
  points: TrackPoint[];
  collisionMs: number;
  fromMs: number;
  toMs: number;
}) {
  const W = 640;
  const H = 180;
  const padL = 38;
  const padR = 12;
  const padT = 12;
  const padB = 26;

  const series = points
    .map((p) => ({
      ms: new Date(p.t).getTime(),
      mph: (p.speedKph ?? 0) * KPH_TO_MPH,
    }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);

  if (series.length === 0) {
    return <div className="vt-map-empty">No GPS/speed data in this window.</div>;
  }

  const span = Math.max(toMs - fromMs, 1);
  const maxMph = Math.max(10, ...series.map((p) => p.mph)) * 1.1;
  const x = (ms: number) => padL + ((ms - fromMs) / span) * (W - padL - padR);
  const y = (mph: number) => H - padB - (mph / maxMph) * (H - padT - padB);

  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ms).toFixed(1)},${y(p.mph).toFixed(1)}`)
    .join(" ");

  const collisionX = x(collisionMs);
  const speedAtImpact = (() => {
    // Nearest sample to the collision moment.
    let best = series[0];
    for (const p of series) {
      if (Math.abs(p.ms - collisionMs) < Math.abs(best.ms - collisionMs)) best = p;
    }
    return best.mph;
  })();

  const yTicks = [0, maxMph / 2, maxMph];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vt-speedchart" role="img" aria-label="Speed chart">
      {/* Y grid + labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="#e2e8f1" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#5a6b87">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {/* Collision marker */}
      <line x1={collisionX} y1={padT} x2={collisionX} y2={H - padB} stroke="#b23b3b" strokeWidth="2" strokeDasharray="4 3" />
      <text x={collisionX} y={padT + 2} textAnchor="middle" fontSize="10" fill="#b23b3b">
        impact
      </text>
      {/* Speed line */}
      <path d={path} fill="none" stroke="#25477b" strokeWidth="2" />
      {/* Axis labels */}
      <text x={(W + padL) / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#5a6b87">
        {new Date(fromMs).toLocaleTimeString()} → {new Date(toMs).toLocaleTimeString()} · mph
      </text>
      <text x={collisionX} y={y(speedAtImpact) - 6} textAnchor="middle" fontSize="10" fill="#b23b3b">
        {speedAtImpact.toFixed(0)} mph
      </text>
    </svg>
  );
}
