"use client";

import { useState } from "react";

export interface TrendPoint {
  id: string;
  label: string;
  rate: number;
  total: number;
  exceptions: number;
}

/**
 * Reconciliation rate over recent runs. One series, one axis (0–100%), 2px line, ≥8px markers,
 * hover/focus tooltip, and a table alternative for screen readers.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return null;
  const W = 640;
  const H = 200;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const minRate = Math.min(...points.map((p) => p.rate));
  const yMin = Math.max(0, Math.floor((minRate * 100 - 5) / 10) * 10) / 100;
  const x = (i: number) => (points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (r: number) => pad.t + (1 - (r - yMin) / (1 - yMin || 1)) * (H - pad.t - pad.b);
  const ticks = [yMin, yMin + (1 - yMin) / 2, 1];
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const a = active !== null ? points[active] : null;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label="Reconciliation rate by run; table follows">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)" className="tabular">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {a ? <line x1={x(active!)} x2={x(active!)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeDasharray="3 3" /> : null}
        {points.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.rate)} r={active === i ? 6 : 4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            <circle
              cx={x(i)}
              cy={y(p.rate)}
              r={14}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.label}: ${(p.rate * 100).toFixed(1)}% reconciled, ${p.exceptions} exceptions`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
            {(i === 0 || i === points.length - 1 || points.length <= 7) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {a ? (
        <div
          role="status"
          className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `${(x(active!) / W) * 100}%`, transform: `translateX(${active! > points.length / 2 ? "-105%" : "5%"})` }}
        >
          <p className="font-semibold text-ink">{a.label}</p>
          <p className="tabular text-ink-2">{(a.rate * 100).toFixed(1)}% reconciled</p>
          <p className="tabular text-ink-2">
            {a.total.toLocaleString("en-IN")} txns · {a.exceptions.toLocaleString("en-IN")} exceptions
          </p>
        </div>
      ) : null}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-3 hover:text-ink">Show as table</summary>
        <table className="data-table mt-2">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col" className="num">
                Transactions
              </th>
              <th scope="col" className="num">
                Reconciled
              </th>
              <th scope="col" className="num">
                Exceptions
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td className="num">{p.total.toLocaleString("en-IN")}</td>
                <td className="num">{(p.rate * 100).toFixed(1)}%</td>
                <td className="num">{p.exceptions.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
