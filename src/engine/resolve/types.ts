import type { CombatResult } from "../combat/types";
import type { ResourceAmounts } from "../ruleset/common";
import type { MapScale, WorldConnection, WorldRegion, WorldTerrainArea, WorldUnit } from "../world/types";

// The whole game state as the resolution engine sees it, and the small set of
// changes a resolved order can make to it. The server turns each change into
// database writes (with an audit entry so it can be undone).

export interface WorldTeam {
  id: string;
  name: string;
  colour: string;
  isNpc: boolean;
  emblem?: string;
  resources: ResourceAmounts;
  baseRaceId: string | null;
  raceIds: string[];
  knownRecipeIds: string[];
}

export interface World {
  /** Hidden units each team has spotted (teamId → unit IDs). Optional for tests. */
  detections?: Record<string, string[]>;
  regions: WorldRegion[];
  connections: WorldConnection[];
  units: WorldUnit[];
  teams: WorldTeam[];
  /** teamId → itemId → quantity. */
  inventory: Record<string, Record<string, number>>;
  /** Hidden connections each team has discovered (teamId → connection IDs). Optional for tests. */
  knownConnections?: Record<string, string[]>;
  /** Difficult ground drawn over the map. Optional for tests. */
  terrain?: WorldTerrainArea[];
  /** For measuring moves. Optional for tests (then the default map size and 200 miles across). */
  map?: MapScale;
}

export type Change =
  | { type: "resources"; teamId: string; delta: ResourceAmounts }
  /** x, y: where in the region it stops (fractions of the map); missing = the region's centre. */
  | { type: "moveUnit"; unitId: string; regionId: string; milesUsed: number; x?: number; y?: number }
  | { type: "updateUnit"; unitId: string; patch: Partial<Pick<WorldUnit, "hp" | "status" | "augmentIds" | "academyBonus" | "milesUsed" | "usesSpent" | "ownerTeamId">> }
  | { type: "createUnit"; unit: Omit<WorldUnit, "id"> & { id: string } }
  | { type: "updateRegion"; regionId: string; patch: Partial<Pick<WorldRegion, "ownerTeamId" | "settlementTierId" | "buildings">> }
  | { type: "inventory"; teamId: string; itemId: string; delta: number }
  | { type: "learnRecipes"; teamId: string; recipeIds: string[] }
  | { type: "gainRaces"; teamId: string; raceIds: string[] }
  /** A team has spotted hidden units. */
  | { type: "detectUnits"; teamId: string; unitIds: string[]; round: number }
  /** Units slipped back into hiding: nobody has spotted them any more. */
  | { type: "clearDetections"; unitIds: string[] };

/** One roll, with everything needed to show and replay it. */
export interface RollRecord {
  label: string;
  /** e.g. "1d20+3". */
  expression: string;
  seed: string;
  /** "d20 (14) + STR 3 + Hunter's Post 1 = 18". */
  breakdown: string;
  total: number;
  tableId: string | null;
  /** The band's outcome text, if a table was used. */
  outcome: string | null;
}

/**
 * ready = nothing to decide; needsReview = has a roll or a text-only effect;
 * needsDm = the DM resolves it by hand; invalid = it can't happen as ordered.
 */
export type ProposalStatus = "ready" | "needsReview" | "needsDm" | "invalid";

export interface Proposal {
  status: ProposalStatus;
  /** Why it can't happen as ordered. */
  problems: string[];
  /** Things for the DM to check or do by hand. */
  notes: string[];
  rolls: RollRecord[];
  changes: Change[];
  /** Drafted outcome text for the team. */
  text: string;
  /** Regions the order acts on or passes through, and other teams it targets. */
  regions: string[];
  targetsTeams: string[];
  /** Where the order's units end up (for spotting likely fights). */
  endsIn: { unitId: string; regionId: string }[];
  /** Fights the order caused, simulated. */
  combats?: CombatResult[];
  /** What other teams are told (e.g. "your units in A3 were attacked"). */
  reports?: { teamId: string; text: string }[];
}
