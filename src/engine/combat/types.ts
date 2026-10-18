import type { Ruleset } from "../ruleset/ruleset";
import type { WorldRegion, WorldUnit } from "../world/types";

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

export type LogKind = "round" | "initiative" | "attack" | "save" | "heal" | "buff" | "condition" | "death" | "retreat" | "capture" | "info";

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
}

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
