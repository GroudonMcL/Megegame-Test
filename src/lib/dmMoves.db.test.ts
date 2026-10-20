import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Lending units, and the DM moving units from the World map, against a real
// Postgres. Skipped unless TEST_DATABASE_URL is set (see dmEdits.db.test.ts).

const url = process.env.TEST_DATABASE_URL;
vi.mock("server-only", () => ({}));

describe.skipIf(!url)("lending and DM moves (database)", async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const { and, eq } = await import("drizzle-orm");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { db, schema } = await import("@/db");
  const { buildPreset } = await import("@/presets");
  const dm = await import("./dmEdits");
  const moves = await import("./dmMoves");
  const { lendUnit } = await import("./lending");
  const msg = await import("./messages");
  const { setContact } = await import("./contacts");

  const ruleset = buildPreset("utterdark");
  let gameId = "";
  let teamId = "";
  let otherId = "";
  let strangerId = "";
  let a = "";
  let b = "";
  const ids: Record<string, string> = {};

  const square = (i: number): [number, number][] => [
    [i / 4, 0],
    [(i + 1) / 4, 0],
    [(i + 1) / 4, 0.25],
    [i / 4, 0.25],
  ];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    const [game] = await db.insert(schema.games).values({ name: "DM moves test", currentRound: 1, mapMilesAcross: 48 }).returning();
    gameId = game.id;
    await db.insert(schema.gameRulesets).values({ gameId, data: ruleset });
    const code = () => `T${Math.random().toString(36).slice(2, 10)}`;
    const teams = await db
      .insert(schema.teams)
      .values([
        { gameId, name: "Iron Clan", joinCode: code() },
        { gameId, name: "Red Hand", joinCode: code() },
        { gameId, name: "Strangers", joinCode: code() },
      ])
      .returning();
    [teamId, otherId, strangerId] = teams.map((t) => t.id);
    const regions = await db
      .insert(schema.regions)
      .values([
        { gameId, code: "A1", x: 0.125, y: 0.125, polygon: square(0) },
        { gameId, code: "B1", x: 0.375, y: 0.125, polygon: square(1) },
      ])
      .returning();
    [a, b] = regions.map((r) => r.id);
    await db.insert(schema.connections).values({ gameId, regionA: a, regionB: b, kind: "border" });
    const units = await db
      .insert(schema.units)
      .values([
        { gameId, ownerTeamId: teamId, creatureId: "guard", name: "Bram", hp: 11, regionId: a, milesUsed: 3 },
        { gameId, ownerTeamId: teamId, creatureId: "guard", name: "Ash", hp: 11, regionId: a },
        { gameId, ownerTeamId: null, creatureId: "guard", name: "Wolf", hp: 11, regionId: a },
      ])
      .returning();
    for (const u of units) ids[u.name] = u.id;
    await setContact(gameId, teamId, otherId, true, 1);
  });

  afterAll(async () => {
    if (gameId) await db.delete(schema.games).where(eq(schema.games.id, gameId));
  });

  const unit = async (name: string) => (await db.select().from(schema.units).where(eq(schema.units.id, ids[name])))[0];
  const lastLog = async () => (await db.select().from(schema.auditLog).where(eq(schema.auditLog.gameId, gameId))).sort((x, y) => +y.createdAt - +x.createdAt)[0];
  const player = { isDm: false, displayName: "Alice" };

  it("lends a unit to a team the owner has met, and takes it back", async () => {
    expect(await lendUnit(gameId, teamId, ids.Bram, strangerId, player)).toMatch(/met/);
    expect(await lendUnit(gameId, otherId, ids.Bram, otherId, player)).toMatch(/isn't yours/);
    expect(await lendUnit(gameId, teamId, ids.Bram, otherId, player)).toBeNull();
    expect((await unit("Bram")).lentToTeamId).toBe(otherId);
    expect(await lastLog()).toMatchObject({ kind: "unit.lend", actor: "Alice", description: "Iron Clan lent Bram to Red Hand" });
    expect(await lendUnit(gameId, teamId, ids.Bram, null, player)).toBeNull();
    expect((await unit("Bram")).lentToTeamId).toBeNull();
  });

  it("won't lend or take back while the round is being resolved", async () => {
    const [round] = await db.insert(schema.rounds).values({ gameId, number: 1, status: "resolving" }).returning();
    expect(await lendUnit(gameId, teamId, ids.Bram, otherId, player)).toMatch(/resolved/);
    await db.update(schema.rounds).set({ status: "open" }).where(eq(schema.rounds.id, round.id));
  });

  it("logs the DM lending for the team, with a note and undo", async () => {
    expect(await lendUnit(gameId, teamId, ids.Ash, otherId, { isDm: true, displayName: "DM", note: { send: true, text: "Lent Ash for you" } })).toBeNull();
    const [change] = await dm.loadDmChanges(gameId, teamId);
    expect(change.kind).toBe("dm.lend");
    expect((await msg.loadThread(gameId, teamId)).at(-1)?.body).toBe("Lent Ash for you");
    expect(await dm.undoDmChange(gameId, teamId, change.id)).toBeNull();
    expect((await unit("Ash")).lentToTeamId).toBeNull();
  });

  it("moves a team's units instantly (no miles), logs it per team, and undoes it", async () => {
    const r = await moves.dmMoveNow(gameId, [ids.Bram, ids.Wolf], { regionId: b, at: [0.4, 0.1] }, { [teamId]: { send: true, text: "Moved you" } });
    if ("error" in r) throw new Error(r.error);
    expect(r.done.map((c) => c.teamId).sort()).toEqual([teamId, null].sort());
    const bram = await unit("Bram");
    expect(bram).toMatchObject({ regionId: b, milesUsed: 3 });
    expect(bram.x).toBeCloseTo(0.4);
    expect((await msg.loadThread(gameId, teamId)).at(-1)?.body).toBe("Moved you");
    const [change] = await dm.loadDmChanges(gameId, teamId);
    expect(change).toMatchObject({ kind: "dm.move" });
    expect(change.description).toContain("instant change");

    // The wild monster's move undoes from the World map; the team's from either.
    const wild = r.done.find((c) => !c.teamId)!;
    const team = r.done.find((c) => c.teamId)!;
    expect(await moves.undoWorldChange(gameId, wild.auditId)).toBeNull();
    expect((await unit("Wolf")).regionId).toBe(a);
    expect(await moves.undoWorldChange(gameId, wild.auditId)).toMatch(/already/);
    expect(await moves.undoWorldChange(gameId, team.auditId)).toBeNull();
    expect(await unit("Bram")).toMatchObject({ regionId: a, x: null, y: null });
  });

  it("won't undo an instant move once the units have moved on", async () => {
    const r = await moves.dmMoveNow(gameId, [ids.Ash], { regionId: b, at: [0.4, 0.1] }, {});
    if ("error" in r) throw new Error(r.error);
    await db.update(schema.units).set({ x: 0.45 }).where(eq(schema.units.id, ids.Ash));
    expect(await moves.undoWorldChange(gameId, r.done[0].auditId)).toMatch(/moved since/);
    await db.update(schema.units).set({ regionId: a, x: null, y: null }).where(eq(schema.units.id, ids.Ash));
  });

  it("adds a move order for the team (kept submitted), which undo removes", async () => {
    const [round] = await db.select().from(schema.rounds).where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, 1)));
    await db.insert(schema.teamRoundOrders).values({ roundId: round.id, teamId, version: 1, submittedAt: new Date(), submittedBy: "Alice" }).onConflictDoNothing();
    const r = await moves.dmAddMoveOrders(gameId, [{ teamId, unitIds: [ids.Bram, ids.Ash] }], { regionId: b, at: [0.375, 0.125] }, {});
    if ("error" in r) throw new Error(r.error);
    const orders = await db.select().from(schema.orders).where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, teamId)));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ kind: "free", actionTypeId: "move", status: "submitted", bypassed: false, inputs: { "0": [ids.Bram, ids.Ash], "1": [[0.375, 0.125]] } });
    // The units haven't moved: the order is resolved with the round.
    expect((await unit("Bram")).regionId).toBe(a);
    const [change] = await dm.loadDmChanges(gameId, teamId);
    expect(change.kind).toBe("dm.orders");
    expect(await moves.undoWorldChange(gameId, r.done[0].auditId)).toBeNull();
    expect(await db.select().from(schema.orders).where(eq(schema.orders.teamId, teamId))).toEqual([]);
  });

  it("adds a move that fails the team's checks too, marked as bypassed", async () => {
    // Off the far side of B1 and back is further than a guard goes in a round.
    const r = await moves.dmAddMoveOrders(gameId, [{ teamId, unitIds: [ids.Ash] }], { regionId: a, at: [0.01, 0.24] }, {});
    if ("error" in r) throw new Error(r.error);
    const far = await moves.dmAddMoveOrders(gameId, [{ teamId, unitIds: [ids.Ash] }], { regionId: b, at: [0.49, 0.01] }, {});
    if ("error" in far) throw new Error(far.error);
    const orders = await db.select().from(schema.orders).where(eq(schema.orders.teamId, teamId));
    expect(orders.map((o) => [o.position, o.bypassed])).toEqual([
      [0, false],
      [1, true],
    ]);
    await db.delete(schema.orders).where(eq(schema.orders.teamId, teamId));
  });

  it("only adds move orders while a round is open or locked", async () => {
    await db.update(schema.rounds).set({ status: "review" }).where(eq(schema.rounds.gameId, gameId));
    const r = await moves.dmAddMoveOrders(gameId, [{ teamId, unitIds: [ids.Bram] }], { regionId: b, at: [0.375, 0.125] }, {});
    expect(r).toEqual({ error: expect.stringMatching(/open or locked/) });
  });
});
