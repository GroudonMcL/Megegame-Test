import { deriveStats, unitBonuses } from "../ruleset/derive";
import type { Ruleset } from "../ruleset/ruleset";
import type { WorldConnection, WorldUnit } from "../world/types";
import { unitEffects } from "./economy";

// Movement in miles, using D&D overland travel: a 30 ft walker covers
// milesPerDayAt30ft miles a day. Each round gives travelDaysPerRound days.
// Force march and stealth change the budget; the budget is shared by every
// move a unit makes in a round, so it's tracked as a fraction used (0–1).

export type MoveMode = "normal" | "forceMarch" | "stealth";

export function modeMultiplier(r: Ruleset, mode: MoveMode): number {
  if (mode === "forceMarch") return r.settings.movement.forceMarchMultiplier;
  if (mode === "stealth") return r.settings.movement.stealthMultiplier;
  return 1;
}

interface UnitSpeeds {
  walk: number;
  fly: number;
  swim: number;
  climb: number;
  burrow: number;
  /** Ignores difficult terrain (and so does its group, if group is true). */
  explorer: "none" | "self" | "group";
}

export function unitSpeeds(r: Ruleset, u: WorldUnit): UnitSpeeds | null {
  const c = r.creatures.find((x) => x.id === u.creatureId);
  if (!c) return null;
  const stats = deriveStats(c.statBlock, unitBonuses(r, u));
  let explorer: UnitSpeeds["explorer"] = "none";
  for (const e of unitEffects(r, u)) {
    if (e.type === "ignoreDifficultTerrain") explorer = e.group ? "group" : explorer === "group" ? "group" : "self";
  }
  const s = c.statBlock.speed;
  return { walk: stats.speed.total, fly: s.fly, swim: s.swim, climb: s.climb, burrow: s.burrow, explorer };
}

/** Miles a unit can travel in one round at normal pace. */
export function milesPerRound(r: Ruleset, u: WorldUnit): number {
  const s = unitSpeeds(r, u);
  if (!s) return 0;
  const m = r.settings.movement;
  return (Math.max(s.walk, s.fly) / 30) * m.milesPerDayAt30ft * m.travelDaysPerRound;
}

export function connectionMiles(r: Ruleset, c: WorldConnection): number {
  return c.miles ?? r.settings.movement.defaultConnectionMiles;
}

/**
 * Miles one unit spends crossing a connection, or a reason it can't.
 * groupExplorer = someone in its group ignores difficult terrain for the group.
 */
export function crossingMiles(r: Ruleset, c: WorldConnection, s: UnitSpeeds, groupExplorer: boolean): { miles: number } | { blocked: string } {
  const miles = connectionMiles(r, c);
  const terrain = r.terrainTypes.find((t) => t.id === c.terrainId);
  if (!terrain) return { miles };
  if (terrain.requiresMovement.length && !terrain.requiresMovement.some((k) => s[k] > 0)) {
    return { blocked: `${terrain.name} needs a ${terrain.requiresMovement.join(" or ")} speed` };
  }
  const bypass =
    (terrain.bypassedByFlying && s.fly > 0) || (terrain.bypassedByNaturalExplorer && (s.explorer !== "none" || groupExplorer));
  return { miles: bypass ? miles : miles * terrain.costMultiplier };
}

export function findConnection(connections: WorldConnection[], a: string, b: string) {
  return connections.find((c) => (c.regionA === a && c.regionB === b) || (c.regionA === b && c.regionB === a));
}

export interface GroupMember {
  unit: WorldUnit;
  /** Fraction of this round's budget already used. */
  used: number;
}

/**
 * The extra fraction of budget each unit uses to cross one connection in the
 * given mode, or the reason the group can't.
 */
export function stepCost(r: Ruleset, c: WorldConnection, group: GroupMember[], mode: MoveMode): { fractions: number[]; miles: number[] } | { blocked: string } {
  const speeds = group.map((g) => unitSpeeds(r, g.unit));
  const groupExplorer = speeds.some((s) => s?.explorer === "group");
  const fractions: number[] = [];
  const miles: number[] = [];
  for (let i = 0; i < group.length; i++) {
    const s = speeds[i];
    const name = group[i].unit.name || "A unit";
    if (!s) return { blocked: `${name} has no stat block` };
    const crossing = crossingMiles(r, c, s, groupExplorer);
    if ("blocked" in crossing) return { blocked: `${name} can't cross: ${crossing.blocked}` };
    const budget = milesPerRound(r, group[i].unit) * modeMultiplier(r, mode);
    if (budget <= 0) return { blocked: `${name} can't move` };
    fractions.push(crossing.miles / budget);
    miles.push(crossing.miles);
  }
  return { fractions, miles };
}

const EPS = 1e-9;

/**
 * Regions the group can reach from `from` with the movement it has left, and
 * the cheapest way there (the worst-off unit's fraction used).
 */
export function reachable(
  r: Ruleset,
  connections: WorldConnection[],
  from: string,
  group: GroupMember[],
  mode: MoveMode,
): Map<string, { used: number[]; prev: string | null }> {
  const best = new Map<string, { used: number[]; prev: string | null }>();
  if (!group.length) return best;
  best.set(from, { used: group.map((g) => g.used), prev: null });
  const queue = [from];
  const worst = (used: number[]) => Math.max(...used);
  while (queue.length) {
    queue.sort((a, b) => worst(best.get(a)!.used) - worst(best.get(b)!.used));
    const at = queue.shift()!;
    const cur = best.get(at)!;
    for (const c of connections) {
      const next = c.regionA === at ? c.regionB : c.regionB === at ? c.regionA : null;
      if (!next) continue;
      const step = stepCost(r, c, group, mode);
      if ("blocked" in step) continue;
      const used = cur.used.map((u, i) => u + step.fractions[i]);
      if (used.some((u) => u > 1 + EPS)) continue;
      const old = best.get(next);
      if (old && worst(old.used) <= worst(used) + EPS) continue;
      best.set(next, { used, prev: at });
      queue.push(next);
    }
  }
  return best;
}

export { EPS as MOVE_EPSILON };
