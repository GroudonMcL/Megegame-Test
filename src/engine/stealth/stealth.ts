import type { Rng } from "../rng";
import { deriveStats, unitBonuses } from "../ruleset/derive";
import type { Effect } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import { buildingTier, unitEffects } from "../orders/economy";
import type { RollRecord, World } from "../resolve/types";
import { ACTIVE_STATUSES, type WorldUnit } from "../world/types";

// Hidden units. A stealthy unit rolls Stealth against the region's DC for each
// side watching it: the highest passive Perception among that side's units
// there, or the side's watchtower DC if that's higher. A side "watches" a
// region if it has units there or owns a building that sets a stealth DC.

/** A side watching a region: a team, or wild monsters (null). */
export type Observer = string | null;

function creatureOf(r: Ruleset, u: WorldUnit) {
  return r.creatures.find((c) => c.id === u.creatureId);
}

/** Effect-based bonuses on a check ("perception", "stealth", "check:stealth"…) that the stat block doesn't include. */
function checkBonus(effects: Effect[], target: string): number {
  return effects.reduce((s, e) => s + (e.type === "modifier" && e.target === target && e.when.length === 0 && !e.dice ? e.value : 0), 0);
}

function hasMode(effects: Effect[], on: string, mode: "advantage" | "disadvantage") {
  return effects.some((e) => e.type === "advantage" && e.on === on && e.mode === mode && e.when.length === 0);
}

export function passivePerception(r: Ruleset, u: WorldUnit): number {
  const c = creatureOf(r, u);
  if (!c) return 10;
  return deriveStats(c.statBlock, unitBonuses(r, u)).passivePerception.total;
}

/** Stealth bonus, and advantage (+1) or disadvantage (−1) on Stealth checks. */
export function stealthOf(r: Ruleset, u: WorldUnit): { bonus: number; adv: number } {
  const c = creatureOf(r, u);
  if (!c) return { bonus: 0, adv: 0 };
  const effects = unitEffects(r, u);
  const bonus = deriveStats(c.statBlock, unitBonuses(r, u)).stealth.total + checkBonus(effects, "check:stealth");
  const adv = (hasMode(effects, "check:stealth", "advantage") ? 1 : 0) - (hasMode(effects, "check:stealth", "disadvantage") ? 1 : 0);
  return { bonus, adv };
}

/** Wisdom (Perception) bonus for an active search. */
export function perceptionBonus(r: Ruleset, u: WorldUnit): number {
  return passivePerception(r, u) - 10;
}

function stealthEffects(r: Ruleset, region: World["regions"][number]) {
  const out: Extract<Effect, { type: "stealthDc" }>[] = [];
  for (const b of region.buildings) for (const e of buildingTier(r, b)?.tier.effects ?? []) if (e.type === "stealthDc") out.push(e);
  for (const e of r.settlementTiers.find((t) => t.id === region.settlementTierId)?.effects ?? []) if (e.type === "stealthDc") out.push(e);
  return out;
}

export interface Watch {
  observer: Observer;
  dc: number;
  /** Where the DC comes from, for the roll log. */
  source: string;
  /** Watchtowers give stealthy enemies disadvantage. */
  disadvantage: boolean;
}

/** Every side watching a region except `exclude` (the sneaking team), with its stealth DC. */
export function watchers(r: Ruleset, world: World, regionId: string, exclude: Observer, unitName: (u: WorldUnit) => string): Watch[] {
  const region = world.regions.find((x) => x.id === regionId);
  if (!region) return [];
  const sides = new Map<Observer, Watch>();
  const raise = (observer: Observer, dc: number, source: string, disadvantage = false) => {
    if (observer === exclude) return;
    const w = sides.get(observer);
    if (!w || dc > w.dc) sides.set(observer, { observer, dc, source, disadvantage: disadvantage || Boolean(w?.disadvantage) });
    else if (disadvantage) w.disadvantage = true;
  };
  for (const u of world.units) {
    if (u.regionId !== regionId || !ACTIVE_STATUSES.has(u.status)) continue;
    raise(u.ownerTeamId, passivePerception(r, u), `${unitName(u)}'s passive Perception`);
  }
  // Watchtowers in the region, and in neighbouring regions that watch their surroundings.
  if (region.ownerTeamId) for (const e of stealthEffects(r, region)) raise(region.ownerTeamId, e.dc, "a watchtower", e.enemyDisadvantage);
  const neighbours = world.connections
    .filter((c) => !c.hidden && (c.regionA === regionId || c.regionB === regionId))
    .map((c) => world.regions.find((x) => x.id === (c.regionA === regionId ? c.regionB : c.regionA)));
  for (const n of neighbours) {
    if (!n?.ownerTeamId) continue;
    for (const e of stealthEffects(r, n)) if (e.adjacentDc) raise(n.ownerTeamId, e.adjacentDc, `a watchtower in ${n.code}`);
  }
  return [...sides.values()];
}

/** One Stealth check against a watching side. */
export function stealthCheck(r: Ruleset, u: WorldUnit, w: Watch, rng: Rng, label: string): { success: boolean; roll: RollRecord } {
  const s = stealthOf(r, u);
  const adv = s.adv - (w.disadvantage ? 1 : 0);
  const a = rng.int(1, 20);
  const b = adv !== 0 ? rng.int(1, 20) : a;
  const die = adv > 0 ? Math.max(a, b) : adv < 0 ? Math.min(a, b) : a;
  const total = die + s.bonus;
  const success = total >= w.dc;
  const dieText = adv !== 0 ? `d20 (${a}, ${b} ${adv > 0 ? "advantage" : "disadvantage"})` : `d20 (${a})`;
  return {
    success,
    roll: {
      label,
      expression: `1d20${s.bonus >= 0 ? "+" : ""}${s.bonus}`,
      seed: rng.seed,
      breakdown: `${dieText} ${s.bonus >= 0 ? "+" : "−"} Stealth ${Math.abs(s.bonus)} = ${total} vs DC ${w.dc} (${w.source}) → ${success ? "unseen" : "spotted"}`,
      total,
      tableId: null,
      outcome: success ? "unseen" : "spotted",
    },
  };
}

/** An active search (Wisdom/Perception) against a hidden unit's passive Stealth (10 + its Stealth bonus). */
export function searchCheck(r: Ruleset, searchers: WorldUnit[], hidden: WorldUnit, rng: Rng, label: string): { success: boolean; roll: RollRecord } {
  const best = Math.max(...searchers.map((u) => perceptionBonus(r, u)));
  const dc = 10 + stealthOf(r, hidden).bonus;
  const die = rng.int(1, 20);
  const total = die + best;
  const success = total >= dc;
  return {
    success,
    roll: {
      label,
      expression: `1d20${best >= 0 ? "+" : ""}${best}`,
      seed: rng.seed,
      breakdown: `d20 (${die}) ${best >= 0 ? "+" : "−"} Perception ${Math.abs(best)} = ${total} vs its passive Stealth ${dc} → ${success ? "found" : "not found"}`,
      total,
      tableId: null,
      outcome: success ? "found" : "not found",
    },
  };
}
