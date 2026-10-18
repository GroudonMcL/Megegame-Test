import type { Effect } from "../ruleset/effects";

// Plain shapes of the game state the engine works on. They match the database
// rows (src/db/schema.ts) but carry no database or web code.

export interface WorldRegion {
  id: string;
  code: string;
  name: string;
  description: string;
  x: number;
  y: number;
  settleable: boolean;
  hidden: boolean;
  ownerTeamId: string | null;
  settlementTierId: string | null;
  buildings: { buildingId: string; tier: number; choice?: string }[];
  structures: { kind: "ruin" | "dungeon"; name: string; description: string; searched: boolean; hidden: boolean }[];
  deposits: { id: string; name: string; note: string; hidden: boolean; production?: Record<string, number> }[];
  features: Effect[];
}

export interface WorldConnection {
  id: string;
  regionA: string;
  regionB: string;
  miles: number | null;
  terrainId: string;
  hidden: boolean;
}

export interface WorldUnit {
  id: string;
  ownerTeamId: string | null;
  creatureId: string;
  name: string;
  raceId: string | null;
  archetypeId: string | null;
  academyBonus: Record<string, number>;
  augmentIds: string[];
  hp: number;
  regionId: string | null;
  milesUsed: number;
  status: string;
  isLeader: boolean;
  /** Per-round ability uses spent, e.g. { "Fireball": 1 }. */
  usesSpent: Record<string, number>;
}

/** What one team has discovered or been given. */
export interface TeamKnowledge {
  regions: Map<
    string,
    { discovered: boolean; searched: boolean; permanentVision: boolean; lastSeen: RegionMemory | null; lastSeenRound: number | null }
  >;
  /** Hidden connections this team has found. */
  connections: Set<string>;
  /** Hidden units this team has detected. */
  detectedUnits: Set<string>;
}

/** What a team remembers about a region it can no longer see. Units are never remembered. */
export interface RegionMemory {
  name: string;
  description: string;
  ownerTeamId: string | null;
  settlementTierId: string | null;
  buildings: WorldRegion["buildings"];
  structures: { kind: "ruin" | "dungeon"; name: string; description: string; searched: boolean }[];
  deposits: { id: string; name: string; note: string; production?: Record<string, number> }[];
}

/** Units in these states are on the map. */
export const ON_MAP_STATUSES = new Set(["active", "hidden", "dead"]);
/** Units in these states are alive, on the map, and can act and see. */
export const ACTIVE_STATUSES = new Set(["active", "hidden"]);
