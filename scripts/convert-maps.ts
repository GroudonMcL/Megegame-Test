// Turns games that still have an old node map (dots joined by connections)
// into region maps, once each. Runs after the SQL migrations (scripts/migrate.ts),
// so it happens by itself on the next deploy. What it couldn't convert is
// written to the game's History for the DM, and printed here.
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { mapAspect } from "../src/engine/geo/mapSize";
import { convertPathInput, planConversion } from "../src/engine/map/convert";

type Db = PostgresJsDatabase<typeof schema>;

interface RawRuleset {
  settings?: { movement?: { defaultConnectionMiles?: number } };
  terrainTypes?: { id: string; name: string }[];
  actionTypes?: { id: string; inputs?: { type: string }[] }[];
}

export async function convertMaps(db: Db) {
  const games = await db.select().from(schema.games).where(eq(schema.games.mapKind, "nodes"));
  for (const game of games) {
    await db.transaction(async (tx) => {
      const [regions, connections, [rules], image] = await Promise.all([
        tx.select().from(schema.regions).where(eq(schema.regions.gameId, game.id)),
        tx.select().from(schema.connections).where(eq(schema.connections.gameId, game.id)),
        tx.select().from(schema.gameRulesets).where(eq(schema.gameRulesets.gameId, game.id)),
        game.mapAssetId ? tx.select().from(schema.assets).where(eq(schema.assets.id, game.mapAssetId)).then((r) => r[0]) : undefined,
      ]);
      const ruleset = (rules?.data ?? {}) as RawRuleset;
      const plan = planConversion({
        regions: regions.map((r) => ({ id: r.id, code: r.code, x: r.x, y: r.y, polygon: r.polygon })),
        connections,
        aspect: mapAspect(image),
        defaultMiles: ruleset.settings?.movement?.defaultConnectionMiles ?? 12,
        terrainName: (id) => ruleset.terrainTypes?.find((t) => t.id === id)?.name ?? id,
      });

      for (const [id, polygon] of plan.polygons) await tx.update(schema.regions).set({ polygon }).where(eq(schema.regions.id, id));
      for (const c of plan.connections) {
        await tx.update(schema.connections).set({ kind: c.kind, miles: c.miles, terrainId: c.terrainId }).where(eq(schema.connections.id, c.id));
      }
      if (plan.newBlockedBorders.length) {
        await tx.insert(schema.connections).values(
          plan.newBlockedBorders.map(([a, b]) => ({ gameId: game.id, regionA: a < b ? a : b, regionB: a < b ? b : a, kind: "border", blocked: true })),
        );
      }

      // Move orders: their paths were lists of regions; now they're points on the map.
      const pathInputs = new Map((ruleset.actionTypes ?? []).map((a) => [a.id, (a.inputs ?? []).flatMap((inp, i) => (inp.type === "path" ? [String(i)] : []))]));
      const rounds = await tx.select({ id: schema.rounds.id }).from(schema.rounds).where(eq(schema.rounds.gameId, game.id));
      const orders = rounds.length ? await tx.select().from(schema.orders).where(inArray(schema.orders.roundId, rounds.map((r) => r.id))) : [];
      const centre = new Map(regions.map((r) => [r.id, [r.x, r.y] as [number, number]]));
      for (const o of orders) {
        const keys = pathInputs.get(o.actionTypeId) ?? [];
        if (!keys.length) continue;
        const inputs = { ...(o.inputs as Record<string, unknown>) };
        for (const k of keys) inputs[k] = convertPathInput(inputs[k], (id) => centre.get(id) ?? null);
        await tx.update(schema.orders).set({ inputs }).where(eq(schema.orders.id, o.id));
      }

      await tx
        .update(schema.games)
        .set({ mapKind: "regions", ...(plan.milesAcross ? { mapMilesAcross: plan.milesAcross } : {}) })
        .where(and(eq(schema.games.id, game.id), eq(schema.games.mapKind, "nodes")));
      const description = ["Converted the map from dots and connections to regions.", ...plan.report].join("\n\n");
      await tx.insert(schema.auditLog).values({ gameId: game.id, actor: "engine", kind: "map.convert", description });
      console.log(`Map of "${game.name}" converted to regions.\n  ${plan.report.join("\n  ")}`);
    });
  }
}
