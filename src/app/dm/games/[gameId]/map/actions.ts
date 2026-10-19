"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { ABILITIES } from "@/engine/ruleset/common";
import { deriveStats, unitBonuses } from "@/engine/ruleset/derive";
import { Effect } from "@/engine/ruleset/effects";
import { subtractAreas } from "@/engine/geo/clip";
import { labelPoint } from "@/engine/geo/edit";
import { mapAspect } from "@/engine/geo/mapSize";
import { cleanPolygon, type Polygon } from "@/engine/geo/polygon";
import { touches } from "@/engine/geo/regions";
import { voronoiCells } from "@/engine/geo/voronoi";
import { gridPositions, nextRegionCode } from "@/engine/map/codes";
import { parseRegionCsv } from "@/engine/map/csv";
import { MapLook } from "@/engine/world/mapLook";
import sharp from "sharp";
import { audit } from "@/lib/audit";
import { syncBorders } from "@/lib/borders";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";

// Every action re-checks the DM session and that the row belongs to this game.

const GameId = z.uuid();
const RowId = z.uuid();
const Fraction = z.number().min(0).max(1);
// An outline: corners as fractions of the map (a little over the edge is fine).
const Outline = z
  .array(z.tuple([z.number().min(-0.05).max(1.05), z.number().min(-0.05).max(1.05)]))
  .min(3, "A shape needs at least 3 corners.")
  .max(2000);

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

type ConnectionRow = typeof schema.connections.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function outline(raw: unknown): Polygon | { error: string } {
  const parsed = Outline.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return cleanPolygon(parsed.data) ?? { error: "That shape has no area." };
}

async function connectionsOf(tx: Tx | typeof db, gameId: string): Promise<ConnectionRow[]> {
  return tx.select().from(schema.connections).where(eq(schema.connections.gameId, gameId));
}

/** A new region with this outline; its centre (where its name and new units go) is placed inside it. */
export async function createRegionAction(gameId: string, polygon: unknown): Promise<ActionResult<{ region: typeof schema.regions.$inferSelect; connections: ConnectionRow[] }>> {
  const id = await guard(gameId);
  const shape = outline(polygon);
  if ("error" in shape) return fail(shape.error);
  const [cx, cy] = labelPoint(shape);
  return db.transaction(async (tx) => {
    const codes = await tx.select({ code: schema.regions.code }).from(schema.regions).where(eq(schema.regions.gameId, id));
    const [row] = await tx
      .insert(schema.regions)
      .values({ gameId: id, code: nextRegionCode(codes.map((c) => c.code)), x: Math.min(1, Math.max(0, cx)), y: Math.min(1, Math.max(0, cy)), polygon: shape })
      .returning();
    await syncBorders(tx, id);
    await audit(tx, { gameId: id, actor: "dm", kind: "region.create", description: `Added region ${row.code}`, after: row });
    done(id);
    return { ok: true as const, value: { region: row, connections: await connectionsOf(tx, id) } };
  });
}

/**
 * Saves edited outlines (regions and terrain areas) in one go, then brings the
 * borders up to date. A region whose centre ends up outside its new shape gets
 * a new centre inside it.
 */
export async function saveShapesAction(
  gameId: string,
  edits: { regions: { id: string; polygon: unknown }[]; terrain: { id: string; polygon: unknown }[] },
): Promise<ActionResult<{ regions: (typeof schema.regions.$inferSelect)[]; connections: ConnectionRow[]; added: number; removed: number }>> {
  const id = await guard(gameId);
  const regionShapes: [string, Polygon][] = [];
  for (const r of edits.regions) {
    const shape = outline(r.polygon);
    if ("error" in shape) return fail(shape.error);
    regionShapes.push([RowId.parse(r.id), shape]);
  }
  const terrainShapes: [string, Polygon][] = [];
  for (const t of edits.terrain) {
    const shape = outline(t.polygon);
    if ("error" in shape) return fail(shape.error);
    terrainShapes.push([RowId.parse(t.id), shape]);
  }
  return db.transaction(async (tx) => {
    const updated: (typeof schema.regions.$inferSelect)[] = [];
    for (const [rid, polygon] of regionShapes) {
      const [before] = await tx.select().from(schema.regions).where(and(eq(schema.regions.id, rid), eq(schema.regions.gameId, id)));
      if (!before) continue;
      const centreInside = cleanPolygon(polygon) && insidePolygon([before.x, before.y], polygon);
      const [cx, cy] = centreInside ? [before.x, before.y] : labelPoint(polygon);
      const [after] = await tx.update(schema.regions).set({ polygon, x: cx, y: cy }).where(eq(schema.regions.id, rid)).returning();
      updated.push(after);
    }
    for (const [tid, polygon] of terrainShapes) {
      await tx.update(schema.terrainAreas).set({ polygon }).where(and(eq(schema.terrainAreas.id, tid), eq(schema.terrainAreas.gameId, id)));
    }
    const sync = await syncBorders(tx, id);
    await audit(tx, {
      gameId: id,
      actor: "dm",
      kind: "map.shapes",
      description: `Edited ${regionShapes.length} region shape${regionShapes.length === 1 ? "" : "s"} and ${terrainShapes.length} terrain area${terrainShapes.length === 1 ? "" : "s"}`,
    });
    done(id);
    return { ok: true as const, value: { regions: updated, connections: await connectionsOf(tx, id), ...sync } };
  });
}

function insidePolygon([px, py]: [number, number], poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Gives every region without a shape a starting one: the area nearer its centre
 * than any other region's, minus any shapes already drawn.
 */
export async function fillShapesAction(gameId: string): Promise<ActionResult<{ filled: number }>> {
  const id = await guard(gameId);
  return db.transaction(async (tx) => {
    const regions = await tx.select().from(schema.regions).where(eq(schema.regions.gameId, id));
    const [game] = await tx.select({ assetId: schema.games.mapAssetId }).from(schema.games).where(eq(schema.games.id, id));
    const [image] = game?.assetId ? await tx.select({ width: schema.assets.width, height: schema.assets.height }).from(schema.assets).where(eq(schema.assets.id, game.assetId)) : [];
    const drawn = regions.map((r) => cleanPolygon(r.polygon)).filter((p): p is Polygon => p !== null);
    const cells = voronoiCells(
      regions.map((r) => [r.x, r.y] as [number, number]),
      mapAspect(image),
    );
    let filled = 0;
    for (const [i, r] of regions.entries()) {
      if (cleanPolygon(r.polygon)) continue;
      const shape = subtractAreas(cells[i], drawn);
      if (!shape) continue;
      await tx.update(schema.regions).set({ polygon: shape }).where(eq(schema.regions.id, r.id));
      filled++;
    }
    await syncBorders(tx, id);
    await audit(tx, { gameId: id, actor: "dm", kind: "map.fill", description: `Gave ${filled} region${filled === 1 ? "" : "s"} a starting shape` });
    done(id);
    return { ok: true as const, value: { filled } };
  });
}

/** The map's scale: miles across its full width. */
export async function setScaleAction(gameId: string, milesAcross: number): Promise<ActionResult<number>> {
  const id = await guard(gameId);
  const parsed = z.number().positive("The scale must be more than 0 miles.").max(1_000_000).safeParse(milesAcross);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const value = Math.round(parsed.data * 100) / 100;
  await db.update(schema.games).set({ mapMilesAcross: value }).where(eq(schema.games.id, id));
  await audit(db, { gameId: id, actor: "dm", kind: "map.scale", description: `Set the map scale to ${value} miles across` });
  done(id);
  return { ok: true, value };
}

// ——— Terrain areas ———

const TerrainPatch = z.object({ terrainId: z.string().min(1), name: z.string().max(120) });

async function checkTerrainType(gameId: string, terrainId: string) {
  const { ruleset } = await loadRuleset(gameId);
  return ruleset.terrainTypes.some((t) => t.id === terrainId);
}

export async function createTerrainAction(gameId: string, terrainId: string, polygon: unknown): Promise<ActionResult<typeof schema.terrainAreas.$inferSelect>> {
  const id = await guard(gameId);
  const shape = outline(polygon);
  if ("error" in shape) return fail(shape.error);
  if (!(await checkTerrainType(id, terrainId))) return fail("Pick a terrain type from the ruleset.");
  const [row] = await db.insert(schema.terrainAreas).values({ gameId: id, terrainId, polygon: shape }).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "terrain.create", description: "Added a terrain area", after: row });
  done(id);
  return { ok: true, value: row };
}

export async function updateTerrainAction(gameId: string, areaId: string, patch: unknown): Promise<ActionResult<typeof schema.terrainAreas.$inferSelect>> {
  const id = await guard(gameId);
  const parsed = TerrainPatch.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (!(await checkTerrainType(id, parsed.data.terrainId))) return fail("Pick a terrain type from the ruleset.");
  const [row] = await db
    .update(schema.terrainAreas)
    .set(parsed.data)
    .where(and(eq(schema.terrainAreas.id, RowId.parse(areaId)), eq(schema.terrainAreas.gameId, id)))
    .returning();
  if (!row) return fail("That terrain area no longer exists.");
  done(id);
  return { ok: true, value: row };
}

export async function deleteTerrainAction(gameId: string, areaId: string) {
  const id = await guard(gameId);
  const [before] = await db
    .delete(schema.terrainAreas)
    .where(and(eq(schema.terrainAreas.id, RowId.parse(areaId)), eq(schema.terrainAreas.gameId, id)))
    .returning();
  if (before) await audit(db, { gameId: id, actor: "dm", kind: "terrain.delete", description: "Deleted a terrain area", before });
  done(id);
}

export async function moveRegionAction(gameId: string, regionId: string, x: number, y: number) {
  const id = await guard(gameId);
  // Moving a region's centre only changes where its name and new units go, so it isn't written to the audit log.
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

/** A link between two regions that don't touch (a tunnel, a sea lane). Regions that touch already share a border. */
export async function createLinkAction(gameId: string, a: string, b: string): Promise<ActionResult<ConnectionRow>> {
  const id = await guard(gameId);
  const [x, y] = [RowId.parse(a), RowId.parse(b)].sort();
  if (x === y) return fail("A region can't link to itself.");
  const ends = await db.select().from(schema.regions).where(and(eq(schema.regions.gameId, id), inArray(schema.regions.id, [x, y])));
  if (ends.length !== 2) return fail("Both regions must be in this game.");
  const [p, q] = ends.map((r) => cleanPolygon(r.polygon));
  if (p && q && touches(p, q)) return fail("Those regions touch, so they already share a border. Select one of them to block or hide it.");
  const existing = await db.select().from(schema.connections).where(and(eq(schema.connections.regionA, x), eq(schema.connections.regionB, y)));
  if (existing.length) return fail("Those regions are already linked.");
  const [row] = await db.insert(schema.connections).values({ gameId: id, regionA: x, regionB: y, kind: "link" }).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "connection.create", description: "Added a link", after: row });
  done(id);
  return { ok: true, value: row };
}

// Borders: blocked and hidden. Links: also their length and terrain.
const ConnectionPatch = z.object({
  miles: z.number().positive().nullable(),
  terrainId: z.string().min(1),
  hidden: z.boolean(),
  blocked: z.boolean(),
});

export async function updateConnectionAction(gameId: string, connectionId: string, patch: unknown): Promise<ActionResult<typeof schema.connections.$inferSelect>> {
  const id = await guard(gameId);
  const parsed = ConnectionPatch.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const cid = RowId.parse(connectionId);
  const [before] = await db.select().from(schema.connections).where(and(eq(schema.connections.id, cid), eq(schema.connections.gameId, id)));
  if (!before) return fail("That connection no longer exists.");
  const changes = before.kind === "border" ? { hidden: parsed.data.hidden, blocked: parsed.data.blocked } : parsed.data;
  const [after] = await db.update(schema.connections).set(changes).where(eq(schema.connections.id, cid)).returning();
  await audit(db, { gameId: id, actor: "dm", kind: "connection.update", description: "Edited a connection", before, after });
  done(id);
  return { ok: true, value: after };
}

/** Deletes a link. (Borders come from the shapes: block them instead.) */
export async function deleteConnectionAction(gameId: string, connectionId: string): Promise<ActionResult<null>> {
  const id = await guard(gameId);
  const cid = RowId.parse(connectionId);
  const [row] = await db.select().from(schema.connections).where(and(eq(schema.connections.id, cid), eq(schema.connections.gameId, id)));
  if (!row) return { ok: true, value: null };
  if (row.kind === "border") return fail("Borders come from the region shapes. Block it instead, or change the shapes.");
  const [before] = await db.delete(schema.connections).where(eq(schema.connections.id, cid)).returning();
  if (before) await audit(db, { gameId: id, actor: "dm", kind: "connection.delete", description: "Deleted a link", before });
  done(id);
  return { ok: true, value: null };
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

// ——— Height map and look (3D view) ———

const MAX_HEIGHT_BYTES = 8 * 1024 * 1024;
/** Height maps are kept at most this wide or tall: plenty for the 3D mesh, and quick to fog. */
const HEIGHT_SIZE = 1024;

/** Stores a height map (any image; white = highest), as a greyscale PNG. */
export async function uploadHeightMapAction(gameId: string, form: FormData): Promise<ActionResult<{ id: string }>> {
  const id = await guard(gameId);
  const file = form.get("image");
  if (!(file instanceof Blob)) return fail("No image received.");
  if (!IMAGE_TYPES.includes(file.type)) return fail("Use a JPEG, PNG or WebP image.");
  if (file.size > MAX_HEIGHT_BYTES) return fail("The height map is over 8 MB. Try a smaller image.");
  let data: Buffer;
  let width: number;
  let height: number;
  try {
    const out = await sharp(Buffer.from(await file.arrayBuffer()))
      .greyscale()
      .resize({ width: HEIGHT_SIZE, height: HEIGHT_SIZE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    width = out.info.width;
    height = out.info.height;
  } catch {
    return fail("Couldn't read that image.");
  }
  const asset = await db.transaction(async (tx) => {
    const [game] = await tx.select({ heightAssetId: schema.games.heightAssetId }).from(schema.games).where(eq(schema.games.id, id));
    const [row] = await tx
      .insert(schema.assets)
      .values({ gameId: id, kind: "height", mime: "image/png", data, width, height, byteSize: data.length })
      .returning({ id: schema.assets.id });
    await tx.update(schema.games).set({ heightAssetId: row.id }).where(eq(schema.games.id, id));
    if (game?.heightAssetId) await tx.delete(schema.assets).where(eq(schema.assets.id, game.heightAssetId));
    await audit(tx, { gameId: id, actor: "dm", kind: "map.height", description: `Uploaded a height map (${width}×${height})` });
    return row;
  });
  done(id);
  return { ok: true, value: { id: asset.id } };
}

export async function removeHeightMapAction(gameId: string): Promise<ActionResult<null>> {
  const id = await guard(gameId);
  await db.transaction(async (tx) => {
    const [game] = await tx.select({ heightAssetId: schema.games.heightAssetId }).from(schema.games).where(eq(schema.games.id, id));
    if (!game?.heightAssetId) return;
    await tx.update(schema.games).set({ heightAssetId: null }).where(eq(schema.games.id, id));
    await tx.delete(schema.assets).where(eq(schema.assets.id, game.heightAssetId));
    await audit(tx, { gameId: id, actor: "dm", kind: "map.height", description: "Removed the height map" });
  });
  done(id);
  return { ok: true, value: null };
}

export async function saveMapLookAction(gameId: string, look: unknown): Promise<ActionResult<null>> {
  const id = await guard(gameId);
  const parsed = MapLook.safeParse(look);
  if (!parsed.success) return fail("Those lighting settings aren't valid.");
  await db.transaction(async (tx) => {
    await tx.update(schema.games).set({ mapLook: parsed.data }).where(eq(schema.games.id, id));
    await audit(tx, { gameId: id, actor: "dm", kind: "map.look", description: "Changed the map's relief and lighting" });
  });
  done(id);
  return { ok: true, value: null };
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
