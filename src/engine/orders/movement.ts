import { deriveStats, unitBonuses } from "../ruleset/derive";
import type { Ruleset } from "../ruleset/ruleset";
import type { WorldUnit } from "../world/types";
import { unitEffects } from "./economy";

// Movement in miles, using D&D overland travel: a 30 ft walker covers
// milesPerDayAt30ft miles a day. Each round gives travelDaysPerRound days.
// Force march and stealth change the budget; the budget is shared by every
// move a unit makes in a round, so it's tracked as a fraction used (0–1).
// Routes on the map (how far a move goes, and where) are in route.ts.

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

/**
 * How much more a mile of this terrain costs one unit (1 = normal), or why it
 * can't go there. groupExplorer = someone in its group ignores difficult
 * terrain for the group.
 */
export function terrainFactor(r: Ruleset, terrainId: string, s: UnitSpeeds, groupExplorer: boolean): { factor: number } | { blocked: string } {
  const terrain = r.terrainTypes.find((t) => t.id === terrainId);
  if (!terrain) return { factor: 1 };
  if (terrain.requiresMovement.length && !terrain.requiresMovement.some((k) => s[k] > 0)) {
    return { blocked: `${terrain.name} needs a ${terrain.requiresMovement.join(" or ")} speed` };
  }
  const bypass = (terrain.bypassedByFlying && s.fly > 0) || (terrain.bypassedByNaturalExplorer && (s.explorer !== "none" || groupExplorer));
  return { factor: bypass ? 1 : terrain.costMultiplier };
}

export interface GroupMember {
  unit: WorldUnit;
  /** Fraction of this round's budget already used. */
  used: number;
}

const EPS = 1e-9;

export { EPS as MOVE_EPSILON };
