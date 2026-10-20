import type { Polygon } from "../geo/polygon";
import type { Effect } from "../ruleset/effects";

// Plain shapes of the game state the engine works on. They match the database
// rows (src/db/schema.ts) but carry no database or web code.

export interface WorldRegion {
  id: string;
  code: string;
  name: string;
  description: string;
  /** The region's centre (where new units appear), as fractions of the map. */
  x: number;
  y: number;
  /** Its outline, in the same fractions; empty for a region not drawn yet. */
  polygon: Polygon;
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
  /** "border" = the regions touch; "link" = a way between regions that don't (tunnel, sea lane). */
  kind: string;
  /** A closed border: as if the regions weren't neighbours, for moving and for seeing. */
  blocked: boolean;
  /** Links: miles, or null for the straight-line distance. */
  miles: number | null;
  terrainId: string;
  hidden: boolean;
}

/** Difficult ground drawn over the regions. */
export interface WorldTerrainArea {
  id: string;
  terrainId: string;
  polygon: Polygon;
}

/** What's needed to measure distances on the map. */
export interface MapScale {
  /** Map height ÷ width. */
  aspect: number;
  /** Miles across the map's full width. */
  milesAcross: number;
}

export interface ItemQty {
  itemId: string;
  qty: number;
}

export interface WorldUnit {
  id: string;
  ownerTeamId: string | null;
  creatureId: string;
  name: string;
  raceId: string | null;
  archetypeId: string | null;
  academyBonus: Record<string, number>;
  /** Items equipped on the unit; their effects change its stats. */
  equippedItemIds: string[];
  /** Items it carries without using them (missing = none). Loot when it dies in a fight. */
  carried?: ItemQty[];
  /** Items unequipped from it in that round (for the equipSwapLock setting). */
  unequipped?: { round: number; itemIds: string[] } | null;
  hp: number;
  regionId: string | null;
  /** Where in the region it stands (fractions of the map); null = the region's centre. */
  x: number | null;
  y: number | null;
  milesUsed: number;
  status: string;
  isLeader: boolean;
  /** Per-round ability uses spent, e.g. { "Fireball": 1 }. */
  usesSpent: Record<string, number>;
  /** Another team its owner lets move it (both teams can); null or missing = not lent. */
  lentToTeamId?: string | null;
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
