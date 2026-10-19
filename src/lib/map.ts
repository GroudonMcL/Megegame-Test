import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type RegionRow = typeof schema.regions.$inferSelect;
export type ConnectionRow = typeof schema.connections.$inferSelect;
export type UnitRow = typeof schema.units.$inferSelect;

export interface MapImage {
  id: string;
  width: number;
  height: number;
}

export async function loadMapImage(gameId: string): Promise<MapImage | null> {
  const [game] = await db.select({ mapAssetId: schema.games.mapAssetId }).from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game?.mapAssetId) return null;
  const [image] = await db
    .select({ id: schema.assets.id, width: schema.assets.width, height: schema.assets.height })
    .from(schema.assets)
    .where(eq(schema.assets.id, game.mapAssetId))
    .limit(1);
  return image?.width && image.height ? { id: image.id, width: image.width, height: image.height } : null;
}

/** Everything the DM's map screens need for one game. */
export async function loadMapState(gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  const [regions, connections, terrainAreas, units, teams, image] = await Promise.all([
    db.select().from(schema.regions).where(eq(schema.regions.gameId, gameId)).orderBy(asc(schema.regions.code)),
    db.select().from(schema.connections).where(eq(schema.connections.gameId, gameId)),
    db.select().from(schema.terrainAreas).where(eq(schema.terrainAreas.gameId, gameId)).orderBy(asc(schema.terrainAreas.createdAt)),
    db.select().from(schema.units).where(eq(schema.units.gameId, gameId)).orderBy(asc(schema.units.createdAt)),
    db
      .select({ id: schema.teams.id, name: schema.teams.name, colour: schema.teams.colour, isNpc: schema.teams.isNpc, emblem: schema.teams.emblem })
      .from(schema.teams)
      .where(eq(schema.teams.gameId, gameId))
      .orderBy(asc(schema.teams.createdAt)),
    game?.mapAssetId
      ? db
          .select({ id: schema.assets.id, width: schema.assets.width, height: schema.assets.height })
          .from(schema.assets)
          .where(eq(schema.assets.id, game.mapAssetId))
          .limit(1)
          .then((r) => r[0])
      : Promise.resolve(undefined),
  ]);
  const mapImage: MapImage | null = image?.width && image.height ? { id: image.id, width: image.width, height: image.height } : null;
  return { regions, connections, terrainAreas, units, teams, mapImage, milesAcross: game?.mapMilesAcross ?? 200 };
}

/** What the conversion from an old node map left for the DM to check, if it ran for this game. */
export async function loadConversionReport(gameId: string): Promise<string | null> {
  const [row] = await db
    .select({ description: schema.auditLog.description })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.gameId, gameId), eq(schema.auditLog.kind, "map.convert")))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(1);
  return row?.description ?? null;
}

export type MapState = Awaited<ReturnType<typeof loadMapState>>;
