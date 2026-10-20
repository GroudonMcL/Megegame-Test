import { rangeFromText, takesRange } from "./range";
import type { ActionProfile, Range } from "./statblock";

// Gives ranges to the attacks and save effects in a saved game ruleset that
// don't have one yet: from the action's text ("range 150/600 ft"), or else
// from the preset the game started from (its spells and items by ID). Used once
// on games created before fights had approach rounds (scripts/fill-ranges.ts).
// A range the DM already set is kept.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

interface Holder {
  name?: string;
  text?: string;
  description?: string;
  profile: ActionProfile;
}

const isHolder = (x: Raw): x is Holder => Boolean(x && typeof x === "object" && x.profile && typeof x.profile === "object" && typeof x.profile.kind === "string");

/** spell ID → range, and "item ID:action name" → range, from a preset ruleset. */
export function presetRanges(preset: Raw): Map<string, Range> {
  const out = new Map<string, Range>();
  for (const s of preset?.spells ?? []) if (s.profile?.range) out.set(`spell:${s.id}`, s.profile.range);
  for (const i of preset?.items ?? []) {
    for (const e of i.effects ?? []) if (e.type === "grantAction" && e.action?.profile?.range) out.set(`item:${i.id}:${e.action.name}`, e.action.profile.range);
  }
  return out;
}

/** The ruleset data with ranges filled in, and a description of each one that changed. */
export function fillRanges(data: Raw, fromPreset: Map<string, Range> = new Map()): { data: Raw; changed: string[] } {
  const changed: string[] = [];

  function fill(h: Holder, where: string, presetKey: string | null): Holder {
    const p = h.profile;
    if (!takesRange(p) && !(p.kind === "buff" && p.target === "enemy")) return h;
    if ("range" in p && p.range) return h;
    const range = (takesRange(p) ? rangeFromText(h.text ?? h.description ?? "", p) : undefined) ?? (presetKey ? fromPreset.get(presetKey) : undefined);
    if (!range) return h;
    changed.push(`${where}: ${h.name ?? "an action"} ${range.normal}${range.long ? `/${range.long}` : ""} ft`);
    return { ...h, profile: { ...p, range } as ActionProfile };
  }

  /** Every action-like object (it has a combat profile) anywhere inside x. */
  function walk(x: Raw, where: string, presetKey: (h: Holder) => string | null): Raw {
    if (Array.isArray(x)) {
      let same = true;
      const out = x.map((y) => {
        const z = walk(y, where, presetKey);
        if (z !== y) same = false;
        return z;
      });
      return same ? x : out;
    }
    if (!x || typeof x !== "object") return x;
    let obj = x;
    if (isHolder(x)) obj = fill(x, where, presetKey(x));
    let copy: Raw = null;
    for (const [k, v] of Object.entries(obj)) {
      if (k === "profile") continue;
      const w = walk(v, where, presetKey);
      if (w !== v) (copy ??= { ...obj })[k] = w;
    }
    return copy ?? obj;
  }

  const out = { ...data };
  let any = false;
  const section = (key: string, label: (x: Raw) => string, presetKey: (x: Raw, h: Holder) => string | null) => {
    if (!Array.isArray(data?.[key])) return;
    const list = data[key].map((x: Raw) => walk(x, label(x), (h) => presetKey(x, h)));
    if (list.some((x: Raw, i: number) => x !== data[key][i])) {
      out[key] = list;
      any = true;
    }
  };
  section("creatures", (c) => c.statBlock?.name ?? c.id, () => null);
  section("spells", () => "Spells", (s) => `spell:${s.id}`);
  section("items", () => "Items", (i, h) => `item:${i.id}:${h.name}`);
  section("archetypes", (a) => a.name ?? a.id, () => null);
  section("races", (a) => a.name ?? a.id, () => null);
  return { data: any ? out : data, changed };
}
