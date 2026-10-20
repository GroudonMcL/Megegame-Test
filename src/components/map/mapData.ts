// Plain shapes of the map rows as sent to the browser (dates become strings).

import type { Effect } from "@/engine/ruleset/effects";

export interface RegionData {
  id: string;
  code: string;
  name: string;
  description: string;
  x: number;
  y: number;
  polygon: [number, number][];
  settleable: boolean;
  hidden: boolean;
  ownerTeamId: string | null;
  settlementTierId: string | null;
  buildings: { buildingId: string; tier: number; choice?: string }[];
  structures: { kind: "ruin" | "dungeon"; name: string; description: string; searched: boolean; hidden: boolean }[];
  deposits: { id: string; name: string; note: string; hidden: boolean; production?: Record<string, number> }[];
  features: Effect[];
  notes: string;
}

export interface ConnectionData {
  id: string;
  regionA: string;
  regionB: string;
  kind: string;
  blocked: boolean;
  miles: number | null;
  terrainId: string;
  hidden: boolean;
}

export interface UnitData {
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
  x: number | null;
  y: number | null;
  status: string;
  isLeader: boolean;
  notes: string;
  /** Another team its owner lets move it. */
  lentToTeamId?: string | null;
}

export interface TerrainAreaData {
  id: string;
  terrainId: string;
  name: string;
  polygon: [number, number][];
}

export interface TeamData {
  id: string;
  name: string;
  colour: string;
  isNpc: boolean;
  emblem: string;
}

export interface MapImageData {
  id: string;
  width: number;
  height: number;
}

/** Without an image the map is a plain grid of this size. */
export { DEFAULT_MAP_SIZE } from "@/engine/geo/mapSize";

/** Picks the fields of a region the editor can change. */
export function regionPatch(r: RegionData) {
  const { code, name, description, settleable, hidden, ownerTeamId, settlementTierId, buildings, structures, deposits, features, notes } = r;
  return { code, name, description, settleable, hidden, ownerTeamId, settlementTierId, buildings, structures, deposits, features, notes };
}
