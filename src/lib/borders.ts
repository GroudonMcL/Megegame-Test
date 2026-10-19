import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { cleanPolygon } from "@/engine/geo/polygon";
import { planBorderSync } from "@/engine/map/convert";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Makes a game's borders match its region shapes: call after any shape changes,
 * in the same transaction. Returns how many borders were added and removed.
 */
export async function syncBorders(tx: Tx, gameId: string): Promise<{ added: number; removed: number }> {
  const [regions, rows] = await Promise.all([
    tx.select({ id: schema.regions.id, polygon: schema.regions.polygon }).from(schema.regions).where(eq(schema.regions.gameId, gameId)),
    tx
      .select({ id: schema.connections.id, regionA: schema.connections.regionA, regionB: schema.connections.regionB, kind: schema.connections.kind })
      .from(schema.connections)
      .where(eq(schema.connections.gameId, gameId)),
  ]);
  const shapes = regions.flatMap((r) => {
    const polygon = cleanPolygon(r.polygon);
    return polygon ? [{ id: r.id, polygon }] : [];
  });
  const plan = planBorderSync(shapes, rows);
  if (plan.remove.length) await tx.delete(schema.connections).where(inArray(schema.connections.id, plan.remove));
  if (plan.toBorder.length) await tx.update(schema.connections).set({ kind: "border", miles: null }).where(inArray(schema.connections.id, plan.toBorder));
  if (plan.add.length) {
    // region_a is always the smaller ID, so each pair is stored once.
    await tx.insert(schema.connections).values(plan.add.map(([a, b]) => ({ gameId, regionA: a < b ? a : b, regionB: a < b ? b : a, kind: "border" })));
  }
  return { added: plan.add.length, removed: plan.remove.length };
}
