import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Equipping and unequipping items, and the DM changing archetypes, against a
// real Postgres. Skipped unless TEST_DATABASE_URL is set (see dmEdits.db.test.ts).

const url = process.env.TEST_DATABASE_URL;
vi.mock("server-only", () => ({}));

describe.skipIf(!url)("equipment (database)", async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const { and, eq } = await import("drizzle-orm");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { db, schema } = await import("@/db");
  const { buildPreset } = await import("@/presets");
  const dm = await import("./dmEdits");
  const { changeEquipment, setArchetype } = await import("./equipment");
  const msg = await import("./messages");

  const ruleset = buildPreset("utterdark");
  let gameId = "";
  let teamId = "";
  let roundId = "";
  let owned = "";
  let wild = "";
  const ids: Record<string, string> = {};
  const player = { isDm: false, displayName: "Alice" };
  const ARMOUR = "plus1-armour";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    const [game] = await db.insert(schema.games).values({ name: "Equipment test", currentRound: 1 }).returning();
    gameId = game.id;
    await db.insert(schema.gameRulesets).values({ gameId, data: ruleset });
    const [team] = await db.insert(schema.teams).values({ gameId, name: "Iron Clan", joinCode: `T${Math.random().toString(36).slice(2, 10)}` }).returning();
    teamId = team.id;
    const [round] = await db.insert(schema.rounds).values({ gameId, number: 1, status: "open" }).returning();
    roundId = round.id;
    const regions = await db
      .insert(schema.regions)
      .values([
        { gameId, code: "A1", x: 0.1, y: 0.1, ownerTeamId: teamId },
        { gameId, code: "B1", x: 0.3, y: 0.1 },
      ])
      .returning();
    [owned, wild] = regions.map((r) => r.id);
    const units = await db
      .insert(schema.units)
      .values([
        { gameId, ownerTeamId: teamId, creatureId: "guard", archetypeId: "regiment", name: "Bram", hp: 11, regionId: owned },
        { gameId, ownerTeamId: teamId, creatureId: "guard", archetypeId: "regiment", name: "Ash", hp: 11, regionId: owned },
        { gameId, ownerTeamId: teamId, creatureId: "guard", archetypeId: "regiment", name: "Far", hp: 11, regionId: wild },
        { gameId, ownerTeamId: teamId, creatureId: "guard", name: "Plain", hp: 11, regionId: owned },
      ])
      .returning();
    for (const u of units) ids[u.name] = u.id;
    await db.insert(schema.inventory).values({ teamId, itemId: ARMOUR, qty: 1 });
  });

  afterAll(async () => {
    if (gameId) await db.delete(schema.games).where(eq(schema.games.id, gameId));
  });

  const unit = async (name: string) => (await db.select().from(schema.units).where(eq(schema.units.id, ids[name])))[0];
  const qty = async (itemId: string) => (await db.select().from(schema.inventory).where(and(eq(schema.inventory.teamId, teamId), eq(schema.inventory.itemId, itemId))))[0]?.qty ?? 0;
  const equip = (name: string, kind: "equip" | "unequip" = "equip", by: { isDm: boolean; displayName: string; note?: { send: boolean; text: string } } = player, force = false) =>
    changeEquipment(gameId, teamId, ids[name], { kind, itemId: ARMOUR, force }, by);

  it("equips from the inventory and unequips back into it, at once", async () => {
    expect(await equip("Bram")).toBeNull();
    expect((await unit("Bram")).equippedItemIds).toEqual([ARMOUR]);
    expect(await qty(ARMOUR)).toBe(0);
    expect(await equip("Bram", "unequip")).toBeNull();
    expect((await unit("Bram")).equippedItemIds).toEqual([]);
    expect((await unit("Bram")).unequipped).toEqual({ round: 1, itemIds: [ARMOUR] });
    expect(await qty(ARMOUR)).toBe(1);
  });

  it("the swap lock keeps it for the unit it came from this round", async () => {
    expect(await equip("Ash")).toMatch(/can only go back on that unit/);
    expect(await equip("Bram")).toBeNull();
    expect((await unit("Bram")).unequipped).toBeNull();
    expect(await equip("Bram", "unequip")).toBeNull();
  });

  it("checks requirements, the region and the round", async () => {
    // A new round: Bram's lock from the last test is over.
    await db.update(schema.units).set({ unequipped: null }).where(eq(schema.units.id, ids.Bram));
    expect(await equip("Plain")).toMatch(/needs a Martial unit/);
    expect(await equip("Far")).toMatch(/region you own/);
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.id, roundId));
    expect(await equip("Bram")).toMatch(/locked/);
    await db.update(schema.rounds).set({ status: "open" }).where(eq(schema.rounds.id, roundId));
  });

  it("the DM can override the checks (not the inventory), logs it, sends a note, and can undo it", async () => {
    const dmBy = { isDm: true, displayName: "DM", note: { send: true, text: "The DM armoured Plain." } };
    expect(await equip("Plain", "equip", dmBy)).toMatch(/needs a Martial unit/);
    expect(await equip("Plain", "equip", dmBy, true)).toBeNull();
    expect((await unit("Plain")).equippedItemIds).toEqual([ARMOUR]);
    expect(await qty(ARMOUR)).toBe(0);
    expect((await msg.loadThread(gameId, teamId)).at(-1)?.body).toBe("The DM armoured Plain.");
    expect(await equip("Ash", "equip", dmBy, true)).toMatch(/don't have/);
    const [change] = await dm.loadDmChanges(gameId, teamId);
    expect(change.kind).toBe("dm.equip");
    expect(await dm.undoDmChange(gameId, teamId, change.id)).toBeNull();
    expect((await unit("Plain")).equippedItemIds).toEqual([]);
    expect(await qty(ARMOUR)).toBe(1);
  });

  it("the DM sets an archetype, and can undo it", async () => {
    expect(await setArchetype(gameId, teamId, ids.Plain, "scout")).toBeNull();
    expect((await unit("Plain")).archetypeId).toBe("scout");
    expect(await setArchetype(gameId, teamId, ids.Plain, "nope")).toMatch(/isn't in the rules/);
    const [change] = await dm.loadDmChanges(gameId, teamId);
    expect(change.kind).toBe("dm.archetype");
    expect(await dm.undoDmChange(gameId, teamId, change.id)).toBeNull();
    expect((await unit("Plain")).archetypeId).toBeNull();
  });
});
