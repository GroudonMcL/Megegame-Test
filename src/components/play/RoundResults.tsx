import type { Ruleset } from "@/engine/ruleset/ruleset";
import { FightLog } from "@/components/combat/FightLog";
import type { TeamResults } from "@/lib/results";

const STATUS: Record<string, string> = { resolved: "", failed: "Failed", skipped: "Not carried out" };

export function RoundResults({ result, rules }: { result: TeamResults; rules: Ruleset }) {
  const action = (id: string) => rules.actionTypes.find((a) => a.id === id);
  const signed = (r: Record<string, number>) =>
    Object.entries(r)
      .filter(([, v]) => v)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} ${rules.resources.find((x) => x.id === k)?.name ?? k}`)
      .join(", ");
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {result.orders.map((o) => (
          <li key={o.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-border px-1.5 text-xs">{o.kind === "numbered" ? `Action ${o.slot}` : o.kind === "free" ? "Free" : "Backup"}</span>
              <strong>
                {action(o.actionTypeId)?.icon} {action(o.actionTypeId)?.name ?? o.actionTypeId}
              </strong>
              {STATUS[o.status] && <span className="text-xs text-danger">{STATUS[o.status]}</span>}
              {o.delta && signed(o.delta) && <span className="ml-auto text-xs tabular-nums">{signed(o.delta)}</span>}
            </div>
            {o.text && <p className="mt-1 whitespace-pre-wrap">{o.text}</p>}
            {o.rolls.length > 0 && (
              <ul className="mt-1 font-mono text-xs text-muted">
                {o.rolls.map((r, i) => (
                  <li key={i}>
                    🎲 {r.label}: {r.breakdown}
                  </li>
                ))}
              </ul>
            )}
            {o.fights.map((log, i) => (
              <FightLog key={i} log={log} title={o.fights.length > 1 ? `Fight ${i + 1}: round by round` : "The fight, round by round"} />
            ))}
          </li>
        ))}
        {result.reports.map((x, i) => (
          <li key={`report-${i}`} className="rounded-lg border border-danger/50 p-3 text-sm">
            <strong>⚔ Attacked</strong>
            <p className="mt-1 whitespace-pre-wrap">{x.text}</p>
            {x.fights.map((log, j) => (
              <FightLog key={j} log={log} title="The fight, round by round" />
            ))}
          </li>
        ))}
        {result.orders.length === 0 && <li className="text-sm text-muted">You gave no orders this round.</li>}
      </ol>
      {result.endOfRound && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <h3 className="font-medium">End of round</h3>
          <p className="mt-1">Income and upkeep: {signed(result.endOfRound.change) || "no change"}</p>
          {signed(result.endOfRound.adjust) && <p>Adjusted by the DM: {signed(result.endOfRound.adjust)}</p>}
          {result.endOfRound.lines.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {result.endOfRound.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {result.endOfRound.rolls.length > 0 && (
            <ul className="mt-1 font-mono text-xs text-muted">
              {result.endOfRound.rolls.map((r, i) => (
                <li key={i}>
                  🎲 {r.label}: {r.breakdown}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
