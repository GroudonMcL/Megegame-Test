import { total, type Economy, type EconomyGroup, type EconomyLine } from "@/engine/orders/economy";

// The round's economy, laid out like the Utterdark summary: Start, ad-hoc
// costs, upkeep, income, total change and End, one column per resource.

const GROUP_LABEL: Record<EconomyGroup, string> = {
  orders: "Orders",
  buildings: "Buildings",
  settlements: "Settlements",
  units: "Units",
  passive: "Passive",
};

function Cell({ v, sign = 1, strong }: { v: number | undefined; sign?: 1 | -1; strong?: boolean }) {
  const n = (v ?? 0) * sign;
  return (
    <td className={`px-2 py-1 text-right tabular-nums ${strong ? "font-semibold" : ""} ${n < 0 ? "text-danger" : ""} ${n === 0 ? "text-muted" : ""}`}>
      {n === 0 ? "–" : Math.round(n * 100) / 100}
    </td>
  );
}

function Section({ title, lines, sign, resources }: { title: string; lines: EconomyLine[]; sign: 1 | -1; resources: { id: string; name: string }[] }) {
  const name = (id: string) => resources.find((r) => r.id === id)?.name ?? id;
  const groups = [...new Set(lines.map((l) => l.group))];
  return (
    <>
      <tr className="border-t border-border">
        <th className="px-2 pt-2 text-left text-xs font-medium uppercase tracking-wide text-muted" colSpan={resources.length + 1}>
          {title}
        </th>
      </tr>
      {groups.length === 0 && (
        <tr>
          <td className="px-2 py-1 text-muted" colSpan={resources.length + 1}>
            None
          </td>
        </tr>
      )}
      {groups.map((g) => {
        const rows = lines.filter((l) => l.group === g);
        const sum = total(rows);
        return (
          <tr key={g} className="align-top">
            <td className="px-2 py-1">
              <details>
                <summary className="cursor-pointer">
                  {GROUP_LABEL[g]} <span className="text-muted">({rows.length})</span>
                </summary>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {rows.map((l, i) => (
                    <li key={i}>
                      {l.label}:{" "}
                      {Object.entries(l.amounts)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${v * sign > 0 ? "+" : ""}${v * sign} ${name(k)}`)
                        .join(", ")}
                    </li>
                  ))}
                </ul>
              </details>
            </td>
            {resources.map((r) => (
              <Cell key={r.id} v={sum[r.id]} sign={sign} />
            ))}
          </tr>
        );
      })}
    </>
  );
}

export function EconomyTable({ economy, resources }: { economy: Economy; resources: { id: string; name: string; icon: string; kind: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium"></th>
            {resources.map((r) => (
              <th key={r.id} className="px-2 py-1 text-right font-medium">
                {r.icon} {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1 font-medium">Start</td>
            {resources.map((r) => (
              <Cell key={r.id} v={economy.start[r.id]} strong />
            ))}
          </tr>
          <Section title="Ad-hoc costs" lines={economy.adhoc} sign={-1} resources={resources} />
          <Section title="Upkeep" lines={economy.upkeep} sign={-1} resources={resources} />
          <Section title="Income" lines={economy.income} sign={1} resources={resources} />
          <tr className="border-t border-border">
            <td className="px-2 py-1 font-medium">Total change</td>
            {resources.map((r) => (
              <Cell key={r.id} v={economy.change[r.id]} strong />
            ))}
          </tr>
          <tr className="border-t-2 border-border">
            <td className="px-2 py-1 font-medium">End (projected)</td>
            {resources.map((r) => (
              <Cell key={r.id} v={economy.end[r.id]} strong />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
