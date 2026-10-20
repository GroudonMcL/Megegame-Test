import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { mapAspect } from "@/engine/geo/mapSize";
import { cleanPolygon } from "@/engine/geo/polygon";
import type { World } from "@/engine/resolve/types";
import type { MapScale, WorldConnection, WorldRegion, WorldTerrainArea, WorldUnit } from "@/engine/world/types";

// The whole state of one game, as plain rows. Used for resolution and frozen
// into rounds.start_snapshot so players see the world as it was when the DM
// started resolving, until the round is published.

type Db = Pick<typeof db, "select">;

export interface GameRows {
  regions: (typeof schema.regions.$inferSelect)[];
  connections: (typeof schema.connections.$inferSelect)[];
  units: (typeof schema.units.$inferSelect)[];
  teams: (typeof schema.teams.$inferSelect)[];
  inventory: (typeof schema.inventory.$inferSelect)[];
  regionKnowledge: (typeof schema.teamRegionKnowledge.$inferSelect)[];
  connectionKnowledge: (typeof schema.teamConnectionKnowledge.$inferSelect)[];
  detections: (typeof schema.teamUnitDetections.$inferSelect)[];
  /** Missing from snapshots taken before regions had shapes. */
  terrainAreas?: (typeof schema.terrainAreas.$inferSelect)[];
  map?: MapScale;
}

export function toWorldRegion(r: typeof schema.regions.$inferSelect): WorldRegion {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    x: r.x,
    y: r.y,
    polygon: cleanPolygon(r.polygon) ?? [],
    settleable: r.settleable,
    hidden: r.hidden,
    ownerTeamId: r.ownerTeamId,
    settlementTierId: r.settlementTierId,
    buildings: r.buildings,
    structures: r.structures,
    deposits: r.deposits,
    features: r.features as WorldRegion["features"],
  };
}

export function toWorldUnit(u: typeof schema.units.$inferSelect): WorldUnit {
  return {
    id: u.id,
    ownerTeamId: u.ownerTeamId,
    creatureId: u.creatureId,
    name: u.name,
    raceId: u.raceId,
    archetypeId: u.archetypeId,
    academyBonus: u.academyBonus,
    augmentIds: u.augmentIds,
    hp: u.hp,
    regionId: u.regionId,
    x: u.x ?? null,
    y: u.y ?? null,
    milesUsed: u.milesUsed,
    status: u.status,
    isLeader: u.isLeader,
    usesSpent: u.usesSpent,
    // Missing from snapshots taken before units could be lent.
    lentToTeamId: u.lentToTeamId ?? null,
  };
}

/** Map height ÷ width and the scale, for measuring moves. */
export async function loadMapScale(gameId: string, tx: Db = db): Promise<MapScale> {
  const [game] = await tx.select({ milesAcross: schema.games.mapMilesAcross, assetId: schema.games.mapAssetId }).from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  const [image] = game?.assetId
    ? await tx.select({ width: schema.assets.width, height: schema.assets.height }).from(schema.assets).where(eq(schema.assets.id, game.assetId)).limit(1)
    : [];
  return { aspect: mapAspect(image), milesAcross: game?.milesAcross ?? 200 };
}

export async function loadGameRows(gameId: string, tx: Db = db): Promise<GameRows> {
  const teams = await tx.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt));
  const teamIds = teams.map((t) => t.id);
  const none = Promise.resolve([]);
  const [regions, connections, units, inventory, regionKnowledge, connectionKnowledge, detections, terrainAreas, map] = await Promise.all([
    tx.select().from(schema.regions).where(eq(schema.regions.gameId, gameId)).orderBy(asc(schema.regions.code)),
    tx.select().from(schema.connections).where(eq(schema.connections.gameId, gameId)),
    tx.select().from(schema.units).where(eq(schema.units.gameId, gameId)).orderBy(asc(schema.units.createdAt)),
    teamIds.length ? tx.select().from(schema.inventory).where(inArray(schema.inventory.teamId, teamIds)) : none,
    teamIds.length ? tx.select().from(schema.teamRegionKnowledge).where(inArray(schema.teamRegionKnowledge.teamId, teamIds)) : none,
    teamIds.length ? tx.select().from(schema.teamConnectionKnowledge).where(inArray(schema.teamConnectionKnowledge.teamId, teamIds)) : none,
    teamIds.length ? tx.select().from(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.teamId, teamIds)) : none,
    tx.select().from(schema.terrainAreas).where(eq(schema.terrainAreas.gameId, gameId)),
    loadMapScale(gameId, tx),
  ]);
  return { regions, connections, units, teams, inventory, regionKnowledge, connectionKnowledge, detections, terrainAreas, map } as GameRows;
}

export function toWorldTerrain(a: typeof schema.terrainAreas.$inferSelect): WorldTerrainArea {
  return { id: a.id, terrainId: a.terrainId, polygon: cleanPolygon(a.polygon) ?? [] };
}

/** Connections as the engine sees them (snapshots from before regions had shapes lack kind and blocked). */
export function toWorldConnection(c: typeof schema.connections.$inferSelect): WorldConnection {
  return { id: c.id, regionA: c.regionA, regionB: c.regionB, kind: c.kind ?? "border", blocked: c.blocked ?? false, miles: c.miles, terrainId: c.terrainId, hidden: c.hidden };
}

export function rowsToWorld(rows: GameRows): World {
  const inventory: World["inventory"] = {};
  for (const i of rows.inventory) if (i.qty > 0) (inventory[i.teamId] ??= {})[i.itemId] = i.qty;
  const detections: Record<string, string[]> = {};
  for (const d of rows.detections ?? []) (detections[d.teamId] ??= []).push(d.unitId);
  const knownConnections: Record<string, string[]> = {};
  for (const k of rows.connectionKnowledge ?? []) (knownConnections[k.teamId] ??= []).push(k.connectionId);
  return {
    detections,
    knownConnections,
    regions: rows.regions.map(toWorldRegion),
    connections: rows.connections.map(toWorldConnection),
    units: rows.units.map(toWorldUnit),
    teams: rows.teams.map((t) => ({
      id: t.id,
      name: t.name,
      colour: t.colour,
      isNpc: t.isNpc,
      emblem: t.emblem,
      resources: t.resources,
      baseRaceId: t.baseRaceId,
      raceIds: t.raceIds,
      knownRecipeIds: t.knownRecipeIds,
    })),
    inventory,
    terrain: (rows.terrainAreas ?? []).map(toWorldTerrain),
    map: rows.map,
  };
}

/** Rows read back from a JSON snapshot (dates come back as strings; nothing here relies on them). */
export function rowsFromSnapshot(snapshot: unknown): GameRows | null {
  if (!snapshot || typeof snapshot !== "object" || !("regions" in snapshot)) return null;
  return snapshot as GameRows;
}
