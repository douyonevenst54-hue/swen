import type { MewsLevel } from "@swen/core";
import type { ReactNode } from "react";

export function MewsBadge({ total, level, complete = true }: { total: number; level: MewsLevel; complete?: boolean }) {
  return (
    <span className={`mews mews-${level}`} title={complete ? undefined : "incomplete"}>
      {total}
      {!complete && <sup>*</sup>}
    </span>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "high" | "medium" | "ok" | "muted" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Small inline SVG trend of MEWS totals over time, with level bands behind it. */
export function MewsTrend({ points, medium, high, label }: { points: { t: number; v: number }[]; medium: number; high: number; label: string }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 160;
  const pad = 24;
  const maxV = Math.max(high + 2, ...points.map((p) => p.v));
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / maxV) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={label}>
      <rect x={pad} y={y(maxV)} width={W - pad * 2} height={y(high - 0.5) - y(maxV)} className="band-high" />
      <rect x={pad} y={y(high - 0.5)} width={W - pad * 2} height={y(medium - 0.5) - y(high - 0.5)} className="band-medium" />
      <path d={path} className="trend-line" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.v)} r={3.5} className="trend-dot" />
      ))}
      {[0, medium, high].map((v) => (
        <text key={v} x={4} y={y(v) + 4} className="trend-axis">
          {v}
        </text>
      ))}
    </svg>
  );
}
