import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { World } from "@/engine/resolve/types";
import type { WorldConnection, WorldRegion, WorldUnit } from "@/engine/world/types";

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
}

export function toWorldRegion(r: typeof schema.regions.$inferSelect): WorldRegion {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    x: r.x,
    y: r.y,
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
    milesUsed: u.milesUsed,
    status: u.status,
    isLeader: u.isLeader,
    usesSpent: u.usesSpent,
  };
}

export async function loadGameRows(gameId: string, tx: Db = db): Promise<GameRows> {
  const teams = await tx.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt));
  const teamIds = teams.map((t) => t.id);
  const none = Promise.resolve([]);
  const [regions, connections, units, inventory, regionKnowledge, connectionKnowledge, detections] = await Promise.all([
    tx.select().from(schema.regions).where(eq(schema.regions.gameId, gameId)).orderBy(asc(schema.regions.code)),
    tx.select().from(schema.connections).where(eq(schema.connections.gameId, gameId)),
    tx.select().from(schema.units).where(eq(schema.units.gameId, gameId)).orderBy(asc(schema.units.createdAt)),
    teamIds.length ? tx.select().from(schema.inventory).where(inArray(schema.inventory.teamId, teamIds)) : none,
    teamIds.length ? tx.select().from(schema.teamRegionKnowledge).where(inArray(schema.teamRegionKnowledge.teamId, teamIds)) : none,
    teamIds.length ? tx.select().from(schema.teamConnectionKnowledge).where(inArray(schema.teamConnectionKnowledge.teamId, teamIds)) : none,
    teamIds.length ? tx.select().from(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.teamId, teamIds)) : none,
  ]);
  return { regions, connections, units, teams, inventory, regionKnowledge, connectionKnowledge, detections } as GameRows;
}

export function rowsToWorld(rows: GameRows): World {
  const inventory: World["inventory"] = {};
  for (const i of rows.inventory) if (i.qty > 0) (inventory[i.teamId] ??= {})[i.itemId] = i.qty;
  return {
    regions: rows.regions.map(toWorldRegion),
    connections: rows.connections as WorldConnection[],
    units: rows.units.map(toWorldUnit),
    teams: rows.teams.map((t) => ({
      id: t.id,
      name: t.name,
      colour: t.colour,
      isNpc: t.isNpc,
      resources: t.resources,
      baseRaceId: t.baseRaceId,
      raceIds: t.raceIds,
      knownRecipeIds: t.knownRecipeIds,
    })),
    inventory,
  };
}

/** Rows read back from a JSON snapshot (dates come back as strings; nothing here relies on them). */
export function rowsFromSnapshot(snapshot: unknown): GameRows | null {
  if (!snapshot || typeof snapshot !== "object" || !("regions" in snapshot)) return null;
  return snapshot as GameRows;
}
