"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ABILITIES } from "@/engine/ruleset/common";
import { deriveStats, unitBonuses } from "@/engine/ruleset/derive";
import { Effect } from "@/engine/ruleset/effects";
import { gridPositions, nextRegionCode } from "@/engine/map/codes";
import { parseRegionCsv } from "@/engine/map/csv";
import { audit } from "@/lib/audit";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";

// Every action re-checks the DM session and that the row belongs to this game.

const GameId = z.uuid();
const RowId = z.uuid();
const Fraction = z.number().min(0).max(1);

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function guard(gameId: string) {
  await requireDm();
  return GameId.parse(gameId);
}

function done(gameId: string) {
  revalidatePath(`/dm/games/${gameId}/map`);
  revalidatePath(`/dm/games/${gameId}/world`);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

// ——— Regions ———

export async function createRegionAction(gameId: string, x: number, y: number) {
  const id = await guard(gameId);
  const codes = await db.select({ code: schema.regions.code }).from(schema.regions).where(eq(schema.regions.gameId, id));
  const [row] = await db
    .insert(schema.regions)
    .values({ gameId: id, code: nextRegionCode(codes.map((c) => c.code)), x: Fraction.parse(x), y: Fraction.parse(y) })
    .returning();
  await audit(db, { gameId: id, actor: "dm", kind: "region.create", description: `Added region ${row.code}`, after: row });
  done(id);
  return row;
}

export async function moveRegionAction(gameId: string, regionId: string, x: number, y: number) {
  const id = await guard(gameId);
  // Moving a node only changes the picture, so it isn't written to the audit log.
  await db
    .update(schema.regions)
    .set({ x: Fraction.parse(x), y: Fraction.parse(y) })
    .where(and(eq(schema.regions.id, RowId.parse(regionId)), eq(schema.regions.gameId, id)));
}

const RegionPatch = z.object({
  code: z.string().trim().min(1, "A region needs an ID").max(20),
  name: z.string().max(120),
  description: z.string().max(5000),
  settleable: z.boolean(),
  hidden: z.boolean(),
  ownerTeamId: z.uuid().nullable(),
  settlementTierId: z.string().nullable(),
  buildings: z.array(z.object({ buildingId: z.string().min(1), tier: z.number().int().min(1), choice: z.string().optional() })),
  structures: z.array(
    z.object({ kind: z.enum(["ruin", "dungeon"]), name: z.string(), description: z.string(), searched: z.boolean(), hidden: z.boolean() }),
  ),
  deposits: z.array(
    z.object({ id: z.string(), name: z.string(), note: z.string(), hidden: z.boolean(), production: z.record(z.string(), z.number()).optional() }),
  ),
  features: z.array(Effect),
  notes: z.string().max(5000),
});
export type RegionPatch = z.infer<typeof RegionPatch>;

export async function updateRegionAction(gameId: string, regionId: string, patch: unknown): Promise<ActionResult<typeof schema.regions.$inferSelect>> {
  const id = await guard(gameId);
  const parsed = RegionPatch.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(" › ")}: ${i.message}`).join("; "));
  const p = parsed.data;
  const [before] = await db.select().from(schema.regions).where(and(eq(schema.regions.id, RowId.parse(regionId)), eq(schema.regions.gameId, id)));
  if (!before) return fail("That region no longer exists.");
  const clash = await db
    .select({ id: schema.regions.id })
    .from(schema.regions)
    .where(and(eq(schema.regions.gameId, id), eq(schema.regions.code, p.code)));
  if (clash.some((c) => c.id !== before.id)) return fail(`Another region already has the ID ${p.code}.`);
  if (p.ownerTeamId) {
    const [team] = await db.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.id, p.ownerTeamId), eq(schema.teams.gameId, id)));
    if (!team) return fail("That team isn't in this game.");
  }
  const [after] = await db.update(schema.regions).set(p).where(eq(schema.regions.id, before.id)).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "region.update", description: `Edited region ${after.code}`, before, after });
  done(id);
  return { ok: true, value: after };
}

export async function deleteRegionAction(gameId: string, regionId: string) {
  const id = await guard(gameId);
  const rid = RowId.parse(regionId);
  await db.transaction(async (tx) => {
    const [before] = await tx.delete(schema.regions).where(and(eq(schema.regions.id, rid), eq(schema.regions.gameId, id))).returning();
    if (before) await audit(tx, { gameId: id, actor: "dm", kind: "region.delete", description: `Deleted region ${before.code}`, before });
  });
  done(id);
}

// ——— Connections ———

export async function createConnectionAction(gameId: string, a: string, b: string): Promise<ActionResult<typeof schema.connections.$inferSelect>> {
  const id = await guard(gameId);
  const [x, y] = [RowId.parse(a), RowId.parse(b)].sort();
  if (x === y) return fail("A region can't connect to itself.");
  const ends = await db.select({ id: schema.regions.id }).from(schema.regions).where(and(eq(schema.regions.gameId, id), inArray(schema.regions.id, [x, y])));
  if (ends.length !== 2) return fail("Both regions must be in this game.");
  const existing = await db.select().from(schema.connections).where(and(eq(schema.connections.regionA, x), eq(schema.connections.regionB, y)));
  if (existing.length) return fail("Those regions are already connected.");
  const [row] = await db.insert(schema.connections).values({ gameId: id, regionA: x, regionB: y }).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "connection.create", description: "Added a connection", after: row });
  done(id);
  return { ok: true, value: row };
}

const ConnectionPatch = z.object({
  miles: z.number().positive().nullable(),
  terrainId: z.string().min(1),
  hidden: z.boolean(),
});

export async function updateConnectionAction(gameId: string, connectionId: string, patch: unknown): Promise<ActionResult<typeof schema.connections.$inferSelect>> {
  const id = await guard(gameId);
  const parsed = ConnectionPatch.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const cid = RowId.parse(connectionId);
  const [before] = await db.select().from(schema.connections).where(and(eq(schema.connections.id, cid), eq(schema.connections.gameId, id)));
  if (!before) return fail("That connection no longer exists.");
  const [after] = await db.update(schema.connections).set(parsed.data).where(eq(schema.connections.id, cid)).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "connection.update", description: "Edited a connection", before, after });
  done(id);
  return { ok: true, value: after };
}

export async function deleteConnectionAction(gameId: string, connectionId: string) {
  const id = await guard(gameId);
  const [before] = await db
    .delete(schema.connections)
    .where(and(eq(schema.connections.id, RowId.parse(connectionId)), eq(schema.connections.gameId, id)))
    .returning();
  if (before) await audit(db, { gameId: id, actor: "dm", kind: "connection.delete", description: "Deleted a connection", before });
  done(id);
}

// ——— Region CSV import ———

export async function importRegionsAction(gameId: string, csv: string): Promise<ActionResult<{ created: number; updated: number; problems: string[] }>> {
  const id = await guard(gameId);
  if (csv.length > 2_000_000) return fail("That file is too big (over 2 MB).");
  const parsed = parseRegionCsv(csv);
  if (!parsed.regions.length) return fail(parsed.problems.join(" ") || "No regions found.");
  const existing = await db.select().from(schema.regions).where(eq(schema.regions.gameId, id));
  const byCode = new Map(existing.map((r) => [r.code.toLowerCase(), r]));
  const fresh = parsed.regions.filter((r) => !byCode.has(r.code.toLowerCase()));
  const spots = gridPositions(fresh.length, existing.map((r) => ({ x: r.x, y: r.y })));
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const r of parsed.regions) {
      const structures = [
        ...(r.ruin ? [{ kind: "ruin" as const, ...r.ruin, searched: false, hidden: false }] : []),
        ...(r.dungeon ? [{ kind: "dungeon" as const, ...r.dungeon, searched: false, hidden: false }] : []),
      ];
      const features = r.features ? [{ type: "text" as const, text: r.features }] : [];
      const values = { name: r.name, description: r.description, settleable: r.settleable, structures, features };
      const old = byCode.get(r.code.toLowerCase());
      if (old) {
        await tx.update(schema.regions).set(values).where(eq(schema.regions.id, old.id));
        updated++;
      } else {
        const spot = spots[created];
        await tx.insert(schema.regions).values({ gameId: id, code: r.code, x: spot.x, y: spot.y, ...values });
        created++;
      }
    }
    await audit(tx, { gameId: id, actor: "dm", kind: "region.import", description: `Imported regions from CSV: ${created} new, ${updated} updated` });
  });
  done(id);
  return { ok: true, value: { created, updated, problems: parsed.problems } };
}

// ——— Map image ———

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"];

export async function uploadMapImageAction(gameId: string, form: FormData): Promise<ActionResult<{ id: string; width: number; height: number }>> {
  const id = await guard(gameId);
  const file = form.get("image");
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  if (!(file instanceof Blob)) return fail("No image received.");
  if (!IMAGE_TYPES.includes(file.type)) return fail("Use a JPEG, PNG or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) return fail("The image is still over 4 MB after shrinking. Try a smaller image.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 10000 || height > 10000) {
    return fail("Couldn't read the image size.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  const asset = await db.transaction(async (tx) => {
    const [game] = await tx.select({ mapAssetId: schema.games.mapAssetId }).from(schema.games).where(eq(schema.games.id, id));
    const [row] = await tx
      .insert(schema.assets)
      .values({ gameId: id, kind: "map", mime: file.type, data, width, height, byteSize: data.length })
      .returning({ id: schema.assets.id });
    await tx.update(schema.games).set({ mapAssetId: row.id }).where(eq(schema.games.id, id));
    if (game?.mapAssetId) await tx.delete(schema.assets).where(eq(schema.assets.id, game.mapAssetId));
    await audit(tx, { gameId: id, actor: "dm", kind: "map.image", description: `Uploaded a new map image (${width}×${height})` });
    return row;
  });
  done(id);
  return { ok: true, value: { id: asset.id, width, height } };
}

// ——— Units ———

const UnitFields = z.object({
  name: z.string().max(80),
  creatureId: z.string().min(1),
  ownerTeamId: z.uuid().nullable(),
  raceId: z.string().nullable(),
  archetypeId: z.string().nullable(),
  regionId: z.uuid().nullable(),
  status: z.enum(["active", "hidden", "dead", "captured", "tamed", "stored", "disbanded"]),
  isLeader: z.boolean(),
  academyBonus: z.partialRecord(z.enum(ABILITIES), z.number().int()),
  augmentIds: z.array(z.string()),
  notes: z.string().max(5000),
});

async function checkUnitRefs(gameId: string, u: z.infer<typeof UnitFields>) {
  const { ruleset } = await loadRuleset(gameId);
  const creature = ruleset.creatures.find((c) => c.id === u.creatureId);
  if (!creature) return { error: "That creature isn't in the ruleset." } as const;
  if (u.raceId && !ruleset.races.some((r) => r.id === u.raceId)) return { error: "That race isn't in the ruleset." } as const;
  if (u.archetypeId && !ruleset.archetypes.some((a) => a.id === u.archetypeId)) return { error: "That archetype isn't in the ruleset." } as const;
  if (u.ownerTeamId) {
    const [t] = await db.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.id, u.ownerTeamId), eq(schema.teams.gameId, gameId)));
    if (!t) return { error: "That team isn't in this game." } as const;
  }
  if (u.regionId) {
    const [r] = await db.select({ id: schema.regions.id }).from(schema.regions).where(and(eq(schema.regions.id, u.regionId), eq(schema.regions.gameId, gameId)));
    if (!r) return { error: "That region isn't in this game." } as const;
  }
  const maxHp = deriveStats(creature.statBlock, unitBonuses(ruleset, u)).maxHp.total;
  return { maxHp, name: creature.statBlock.name } as const;
}

export async function spawnUnitsAction(gameId: string, fields: unknown, count: number): Promise<ActionResult<(typeof schema.units.$inferSelect)[]>> {
  const id = await guard(gameId);
  const parsed = UnitFields.safeParse(fields);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const n = z.number().int().min(1).max(20).parse(count);
  const refs = await checkUnitRefs(id, parsed.data);
  if ("error" in refs) return fail(refs.error!);
  const base = parsed.data.name.trim() || refs.name;
  const rows = await db
    .insert(schema.units)
    .values(Array.from({ length: n }, (_, i) => ({ ...parsed.data, gameId: id, name: n > 1 ? `${base} ${i + 1}` : base, hp: refs.maxHp })))
    .returning();
  await audit(db, { gameId: id, actor: "dm", kind: "unit.spawn", description: `Placed ${n} × ${base}`, after: rows });
  done(id);
  return { ok: true, value: rows };
}

export async function updateUnitAction(gameId: string, unitId: string, fields: unknown, hp: number): Promise<ActionResult<typeof schema.units.$inferSelect>> {
  const id = await guard(gameId);
  const parsed = UnitFields.safeParse(fields);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const refs = await checkUnitRefs(id, parsed.data);
  if ("error" in refs) return fail(refs.error!);
  const uid = RowId.parse(unitId);
  const [before] = await db.select().from(schema.units).where(and(eq(schema.units.id, uid), eq(schema.units.gameId, id)));
  if (!before) return fail("That unit no longer exists.");
  const [after] = await db
    .update(schema.units)
    // A unit moved to another region stands at that region's centre.
    .set({ ...parsed.data, hp: z.number().int().min(0).parse(hp), ...(parsed.data.regionId !== before.regionId ? { x: null, y: null } : {}) })
    .where(eq(schema.units.id, uid))
    .returning();
  await audit(db, { gameId: id, actor: "dm", kind: "unit.update", description: `Edited ${after.name}`, before, after });
  done(id);
  return { ok: true, value: after };
}

export async function moveUnitAction(gameId: string, unitId: string, regionId: string | null): Promise<ActionResult<typeof schema.units.$inferSelect>> {
  const id = await guard(gameId);
  const uid = RowId.parse(unitId);
  const target = regionId === null ? null : RowId.parse(regionId);
  if (target) {
    const [r] = await db.select({ id: schema.regions.id }).from(schema.regions).where(and(eq(schema.regions.id, target), eq(schema.regions.gameId, id)));
    if (!r) return fail("That region isn't in this game.");
  }
  const [before] = await db.select().from(schema.units).where(and(eq(schema.units.id, uid), eq(schema.units.gameId, id)));
  if (!before) return fail("That unit no longer exists.");
  // It stands at the new region's centre.
  const [after] = await db.update(schema.units).set({ regionId: target, x: null, y: null }).where(eq(schema.units.id, uid)).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "unit.move", description: `Moved ${after.name}`, before: { regionId: before.regionId }, after: { regionId: target } });
  done(id);
  return { ok: true, value: after };
}

export async function deleteUnitAction(gameId: string, unitId: string) {
  const id = await guard(gameId);
  const [before] = await db
    .delete(schema.units)
    .where(and(eq(schema.units.id, RowId.parse(unitId)), eq(schema.units.gameId, id)))
    .returning();
  if (before) await audit(db, { gameId: id, actor: "dm", kind: "unit.delete", description: `Removed ${before.name}`, before });
  done(id);
}
