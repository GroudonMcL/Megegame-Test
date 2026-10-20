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
  loot: "💰",
  initiative: "⏱",
  move: "➜",
};

export function FightLog({ log, title = "Fight log", open = false }: { log: LogEntry[]; title?: string; open?: boolean }) {
  // Each "round" entry starts a group headed by its text ("Round −1 (distance 120 ft)", "Round 1").
  const groups: { head: string | null; entries: LogEntry[] }[] = [{ head: null, entries: [] }];
  for (const e of log) {
    if (e.kind === "round") groups.push({ head: e.text, entries: [] });
    else groups[groups.length - 1].entries.push(e);
  }
  return (
    <details className="mt-1 rounded-md border border-border text-xs" open={open}>
      <summary className="cursor-pointer select-none px-2 py-1 font-medium">{title}</summary>
      <div className="max-h-96 space-y-2 overflow-y-auto px-2 pb-2">
        {groups
          .filter((g) => g.head || g.entries.length)
          .map((g, n) => (
            <div key={n}>
              {g.head && <p className="mt-1 font-medium text-muted">{g.head}</p>}
              <ul className="space-y-0.5">
                {g.entries.map((e, i) => (
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
