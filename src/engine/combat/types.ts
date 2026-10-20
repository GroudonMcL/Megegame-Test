import type { Ruleset } from "../ruleset/ruleset";
import type { ItemQty, WorldRegion, WorldUnit } from "../world/types";

// The inputs and results of one simulated fight. A fight is pure: the same
// input and seed always give the same result, so it can be shown to the DM,
// re-run with the same dice when it's accepted, or re-rolled.

export interface CombatSideInput {
  /** A team ID, or "wild" for monsters. */
  id: string;
  teamId: string | null;
  name: string;
  units: WorldUnit[];
  /** Attacking from stealth: advantage on initiative and on each unit's first attack. */
  surprising?: boolean;
  /** Force-marching units have disadvantage on attacks and saves. */
  forceMarching?: string[];
  /** unitId → where it retreats to (null or missing = it can't retreat). */
  retreatTo?: Record<string, string | null>;
}

export interface CombatInput {
  ruleset: Ruleset;
  region: WorldRegion | null;
  sides: CombatSideInput[];
  seed: string;
  /** sideId → the enemy unit that side concentrates on while it's standing. */
  priority?: Record<string, string>;
  /** A side trying to capture a monster instead of killing it. */
  capture?: { sideId: string; targetId: string };
}

export type LogKind = "round" | "initiative" | "attack" | "save" | "heal" | "buff" | "condition" | "death" | "retreat" | "capture" | "loot" | "info";

export interface LogEntry {
  round: number;
  kind: LogKind;
  text: string;
}

export type FighterOutcome = "standing" | "dead" | "retreated" | "captured";

export interface CombatUnitResult {
  unitId: string;
  sideId: string;
  label: string;
  startHp: number;
  hp: number;
  maxHp: number;
  outcome: FighterOutcome;
  retreatTo: string | null;
  damageDealt: number;
  damageTaken: number;
  /** The unit's per-round uses after the fight (unit.usesSpent). */
  usesSpent: Record<string, number>;
  /** Created during the fight (raised from the dead); not yet in the world. */
  raised?: { creatureId: string; teamId: string | null };
}

export interface CombatResult {
  seed: string;
  regionId: string | null;
  sides: { id: string; teamId: string | null; name: string }[];
  rounds: number;
  /** The side left standing, or null if nobody won within the round limit. */
  winner: string | null;
  endReason: "wipedOut" | "maxRounds" | "captured" | "noFight";
  log: LogEntry[];
  units: CombatUnitResult[];
  /** Abilities and traits the simulation doesn't understand, for the DM to check. */
  warnings: string[];
  /** What the units that died had on them, and who gets it (set after the fight; missing = nothing). */
  loot?: FightLoot;
}

/**
 * Everything the units that died in a fight carried or had equipped. It goes
 * to the teams with units still standing on the winning side: to the only one
 * straight away, or (several) split by the DM or left for them to share out.
 */
export interface FightLoot {
  /** All of it, added up. */
  items: ItemQty[];
  /** What each unit that died had. */
  from: { unitId: string; label: string; items: ItemQty[] }[];
  /** Teams with a unit still standing on the winning side. Empty = nobody won it, so it stays on the fallen. */
  teamIds: string[];
  /** auto = the one winning team gets it; split = shared out by the DM; note = the teams share it out themselves; corpse = left on the fallen. */
  mode: "auto" | "split" | "note" | "corpse";
  /** teamId → what it receives (auto and split). */
  shares: Record<string, ItemQty[]>;
  /** note: the text sent to each winning team. */
  note?: string;
  /** The DM's split no longer matched the loot (the fight changed), so it all went to one team instead. */
  splitReset?: boolean;
}

/** How the DM hands out loot when several teams won a fight. */
export type LootChoice = { mode: "split"; shares: Record<string, ItemQty[]> } | { mode: "note"; text?: string };

export interface CombatOdds {
  runs: number;
  /** sideId → share of fights won (0–1). */
  wins: Record<string, number>;
  /** Share of fights nobody won within the round limit. */
  draws: number;
  /** sideId → average number of units dead (or captured). */
  losses: Record<string, number>;
  /** sideId → average share of starting HP left. */
  hpLeft: Record<string, number>;
  rounds: number;
}
