import type { Rng } from "./rng";

// Dice expressions: "d20", "2d6+3", "d100", "4d6kh3" (keep highest 3),
// "2d20kh1" (advantage), "2d20kl1" (disadvantage), "1d8-1".

export interface DiceTerm {
  kind: "dice";
  count: number;
  sides: number;
  keep?: { mode: "highest" | "lowest"; n: number };
  sign: 1 | -1;
}
export interface FlatTerm {
  kind: "flat";
  value: number;
  sign: 1 | -1;
}
export type Term = DiceTerm | FlatTerm;

export interface TermResult {
  text: string;
  rolls: number[];
  kept: number[];
  value: number;
}
export interface DiceResult {
  expression: string;
  terms: TermResult[];
  total: number;
}

const TERM_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$|^(\d+)$/;

export function parseDice(expression: string): Term[] {
  const src = expression.replace(/\s+/g, "").toLowerCase();
  if (!src) throw new Error("Empty dice expression");
  const terms: Term[] = [];
  const parts = src.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join("") !== src) throw new Error(`Can't read dice expression "${expression}"`);
  for (const raw of parts) {
    const sign: 1 | -1 = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");
    const m = TERM_RE.exec(body);
    if (!m) throw new Error(`Can't read "${body}" in "${expression}"`);
    if (m[5] !== undefined) {
      terms.push({ kind: "flat", value: Number(m[5]), sign });
      continue;
    }
    const count = m[1] ? Number(m[1]) : 1;
    const sides = Number(m[2]);
    if (count < 1 || count > 1000) throw new Error(`Dice count must be 1-1000 in "${expression}"`);
    if (sides < 1 || sides > 10000) throw new Error(`Dice sides must be 1-10000 in "${expression}"`);
    const term: DiceTerm = { kind: "dice", count, sides, sign };
    if (m[3]) {
      const n = Number(m[4]);
      if (n < 1 || n > count) throw new Error(`Can't keep ${n} of ${count} dice in "${expression}"`);
      term.keep = { mode: m[3] === "kh" ? "highest" : "lowest", n };
    }
    terms.push(term);
  }
  return terms;
}

export function rollDice(expression: string, rng: Rng): DiceResult {
  const terms = parseDice(expression);
  const results: TermResult[] = terms.map((t) => {
    const prefix = t.sign < 0 ? "-" : "+";
    if (t.kind === "flat") {
      return { text: `${prefix}${t.value}`, rolls: [], kept: [], value: t.sign * t.value };
    }
    const rolls = Array.from({ length: t.count }, () => rng.int(1, t.sides));
    let kept = rolls;
    if (t.keep) {
      const sorted = [...rolls].sort((x, y) => (t.keep!.mode === "highest" ? y - x : x - y));
      kept = sorted.slice(0, t.keep.n);
    }
    const keepText = t.keep ? `${t.keep.mode === "highest" ? "kh" : "kl"}${t.keep.n}` : "";
    return {
      text: `${prefix}${t.count}d${t.sides}${keepText}`,
      rolls,
      kept,
      value: t.sign * kept.reduce((s, r) => s + r, 0),
    };
  });
  return { expression, terms: results, total: results.reduce((s, r) => s + r.value, 0) };
}

/** "2d6 (3, 5) + 3 = 11" — the breakdown shown to the DM. */
export function describeRoll(r: DiceResult): string {
  const parts = r.terms.map((t, i) => {
    const sign = t.value < 0 || t.text.startsWith("-") ? "- " : i === 0 ? "" : "+ ";
    const body = t.text.replace(/^[+-]/, "");
    if (t.rolls.length === 0) return `${sign}${body}`;
    const shown = t.rolls.length === t.kept.length ? t.rolls.join(", ") : `${t.rolls.join(", ")} → kept ${t.kept.join(", ")}`;
    return `${sign}${body} (${shown})`;
  });
  return `${parts.join(" ")} = ${r.total}`;
}
