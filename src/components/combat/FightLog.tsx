import type { LogEntry } from "@/engine/combat/types";

// A fight's round-by-round log, folded away until opened.

const ICON: Partial<Record<LogEntry["kind"], string>> = {
  attack: "⚔",
  save: "🛡",
  heal: "✚",
  buff: "✦",
  condition: "◌",
  retreat: "↩",
  capture: "⛓",
  initiative: "⏱",
};

export function FightLog({ log, title = "Fight log", open = false }: { log: LogEntry[]; title?: string; open?: boolean }) {
  const rounds = new Map<number, LogEntry[]>();
  for (const e of log) {
    if (e.kind === "round") continue;
    rounds.set(e.round, [...(rounds.get(e.round) ?? []), e]);
  }
  return (
    <details className="mt-1 rounded-md border border-border text-xs" open={open}>
      <summary className="cursor-pointer select-none px-2 py-1 font-medium">{title}</summary>
      <div className="max-h-96 space-y-2 overflow-y-auto px-2 pb-2">
        {[...rounds.entries()].map(([n, entries]) => (
          <div key={n}>
            {n > 0 && <p className="mt-1 font-medium text-muted">Round {n}</p>}
            <ul className="space-y-0.5">
              {entries.map((e, i) => (
                <li key={i} className={`whitespace-pre-wrap ${e.kind === "info" || e.kind === "initiative" ? "text-muted" : ""} ${e.text.startsWith("  ") ? "pl-4" : ""}`}>
                  {ICON[e.kind] ? `${ICON[e.kind]} ` : ""}
                  {e.text.trim()}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
