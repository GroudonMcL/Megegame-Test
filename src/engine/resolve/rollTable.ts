import { describeRoll, rollDice } from "../dice";
import type { Rng } from "../rng";
import type { Ruleset } from "../ruleset/ruleset";
import type { RollRecord } from "./types";

// Rolling on the DM's outcome tables, including tables that roll on other
// tables ("roll twice on Loot, ignoring 10s").

type TableResult = Ruleset["rollTables"][number]["bands"][number]["results"][number];

export interface Modifier {
  label: string;
  value: number;
}

export interface TableRoll {
  rolls: RollRecord[];
  /** Every structured result from the bands landed on (chained tables already rolled). */
  results: TableResult[];
  /** Outcome text of each band landed on, in order. */
  texts: string[];
}

const MAX_DEPTH = 5;

function bandFor(table: Ruleset["rollTables"][number], total: number) {
  const hit = table.bands.find((b) => total >= b.min && (b.max === null || total <= b.max));
  if (hit) return hit;
  // Below the lowest band or above the highest: use the nearest end.
  const lowest = table.bands.reduce((a, b) => (b.min < a.min ? b : a));
  return total < lowest.min ? lowest : table.bands.reduce((a, b) => ((b.max ?? Infinity) > (a.max ?? Infinity) ? b : a));
}

export function rollOnTable(r: Ruleset, tableId: string, rng: Rng, opts: { label?: string; modifiers?: Modifier[]; ignore?: number[]; depth?: number } = {}): TableRoll {
  const out: TableRoll = { rolls: [], results: [], texts: [] };
  const table = r.rollTables.find((t) => t.id === tableId);
  if (!table) {
    out.texts.push(`(The table "${tableId}" doesn't exist.)`);
    return out;
  }
  const mods = (opts.modifiers ?? []).filter((m) => m.value !== 0);
  let dice = rollDice(table.die, rng);
  // "Ignoring 10s": roll again (a few times at most) if the die shows an ignored number.
  for (let i = 0; i < 10 && opts.ignore?.includes(dice.total); i++) dice = rollDice(table.die, rng);
  const total = dice.total + mods.reduce((s, m) => s + m.value, 0);
  const band = bandFor(table, total);
  const modText = mods.map((m) => ` ${m.value < 0 ? "−" : "+"} ${m.label} ${Math.abs(m.value)}`).join("");
  const diceText = describeRoll(dice).replace(/ = -?\d+$/, "");
  out.rolls.push({
    label: opts.label ?? table.name,
    expression: `${table.die}${mods.map((m) => `${m.value < 0 ? "-" : "+"}${Math.abs(m.value)}`).join("")}`,
    seed: rng.seed,
    breakdown: `${diceText}${modText} = ${total} → ${band.text || "(no text)"}`,
    total,
    tableId: table.id,
    outcome: band.text,
  });
  out.texts.push(band.text);

  for (const res of band.results) {
    if (res.type !== "rollTable") {
      out.results.push(res);
      continue;
    }
    if ((opts.depth ?? 0) >= MAX_DEPTH) {
      out.texts.push(`(Stopped rolling on "${res.tableId}": too many nested tables.)`);
      continue;
    }
    for (let i = 0; i < res.times; i++) {
      const sub = rollOnTable(r, res.tableId, rng, { ignore: res.ignore, depth: (opts.depth ?? 0) + 1 });
      out.rolls.push(...sub.rolls);
      out.results.push(...sub.results);
      out.texts.push(...sub.texts);
    }
  }
  return out;
}
