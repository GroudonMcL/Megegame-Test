"use client";

import { useState } from "react";

// One resource over the rounds, one line per team (in the team's own colour),
// with a hover crosshair, a legend, end-of-line labels and a table view.

export interface Series {
  teamId: string;
  name: string;
  colour: string;
  /** Value after each round, in the same order as `rounds`. */
  values: (number | null)[];
}

const W = 560;
const H = 220;
const PAD = { left: 44, right: 96, top: 12, bottom: 28 };

export function ResourceChart({ title, rounds, series }: { title: string; rounds: number[]; series: Series[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const span = max - min || 1;
  const plotW = W - PAD.left - PAD.right;
  const step = plotW / Math.max(1, rounds.length - 1);
  const x = (i: number) => PAD.left + (rounds.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
  const ticks = [...new Set([min, min + span / 2, max].map((v) => Math.round(v)))];
  // End-of-line labels, pushed apart so they never overlap (at least 13px between them).
  const labelY = new Map<string, number>();
  const ends = series
    .map((s) => {
      const last = s.values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
      return { id: s.teamId, y: last >= 0 ? y(s.values[last]!) : null };
    })
    .filter((e): e is { id: string; y: number } => e.y !== null)
    .sort((a, b) => a.y - b.y);
  let prevY = -Infinity;
  for (const e of ends) {
    prevY = Math.max(e.y, prevY + 13);
    labelY.set(e.id, prevY);
  }

  return (
    <figure className="rounded-xl border border-border bg-card p-3">
      <figcaption className="flex items-center gap-2 text-sm font-medium">
        {title}
        <button type="button" className="ml-auto text-xs font-normal text-accent underline" onClick={() => setTable(!table)}>
          {table ? "Show chart" : "Show table"}
        </button>
      </figcaption>
      {table ? (
        <div className="mt-2 overflow-x-auto">
          <table className="text-xs tabular-nums">
            <thead>
              <tr>
                <th className="pr-3 text-left font-medium">Team</th>
                {rounds.map((r) => (
                  <th key={r} className="px-2 text-right font-medium">
                    R{r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.teamId} className="border-t border-border">
                  <td className="pr-3">{s.name}</td>
                  {s.values.map((v, i) => (
                    <td key={i} className="px-2 text-right">
                      {v ?? "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title} by round for each team`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)">
                  {t}
                </text>
              </g>
            ))}
            {rounds.map((r, i) => (
              <text key={r} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                R{r}
              </text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
            {series.map((s) => {
              const pts = s.values.flatMap((v, i) => (v === null ? [] : [`${x(i)},${y(v)}`]));
              const last = s.values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
              return (
                <g key={s.teamId}>
                  {pts.length > 1 ? (
                    <polyline points={pts.join(" ")} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ) : (
                    last >= 0 && <circle cx={x(last)} cy={y(s.values[last]!)} r={4} fill={s.colour} />
                  )}
                  {hover !== null && s.values[hover] !== null && <circle cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.colour} stroke="var(--card)" strokeWidth={2} />}
                  {series.length <= 4 && last >= 0 && (
                    <text x={x(last) + 8} y={labelY.get(s.teamId) ?? y(s.values[last]!)} dominantBaseline="middle" fontSize={11} fill="var(--foreground)">
                      {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
                    </text>
                  )}
                </g>
              );
            })}
            {rounds.map((r, i) => (
              <rect key={r} x={x(i) - step / 2} y={PAD.top} width={rounds.length > 1 ? step : plotW} height={H - PAD.top - PAD.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          <p className="min-h-4 text-xs tabular-nums" role="status">
            {hover !== null && (
              <>
                <span className="font-medium">Round {rounds[hover]}:</span> {series.map((s) => `${s.name} ${s.values[hover] ?? "–"}`).join(" · ")}
              </>
            )}
          </p>
          {series.length > 1 && (
            <ul className="mt-1 flex flex-wrap gap-3 text-xs">
              {series.map((s) => (
                <li key={s.teamId} className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4" style={{ background: s.colour }} aria-hidden />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </figure>
  );
}
