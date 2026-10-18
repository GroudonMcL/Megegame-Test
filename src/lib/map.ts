import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type RegionRow = typeof schema.regions.$inferSelect;
export type ConnectionRow = typeof schema.connections.$inferSelect;
export type UnitRow = typeof schema.units.$inferSelect;

export interface MapImage {
  id: string;
  width: number;
  height: number;
}

/** Everything the DM's map screens need for one game. */
export async function loadMapState(gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  const [regions, connections, units, teams, image] = await Promise.all([
    db.select().from(schema.regions).where(eq(schema.regions.gameId, gameId)).orderBy(asc(schema.regions.code)),
    db.select().from(schema.connections).where(eq(schema.connections.gameId, gameId)),
    db.select().from(schema.units).where(eq(schema.units.gameId, gameId)).orderBy(asc(schema.units.createdAt)),
    db
      .select({ id: schema.teams.id, name: schema.teams.name, colour: schema.teams.colour, isNpc: schema.teams.isNpc })
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
  return { regions, connections, units, teams, mapImage };
}

export type MapState = Awaited<ReturnType<typeof loadMapState>>;
