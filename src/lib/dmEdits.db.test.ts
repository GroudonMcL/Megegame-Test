import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The DM's changes, undo and messages against a real Postgres. Skipped unless
// TEST_DATABASE_URL points at a database these tests may fill (it's migrated
// first, and each run adds a new game). For example:
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/megagame_test npm test

const url = process.env.TEST_DATABASE_URL;
vi.mock("server-only", () => ({}));

describe.skipIf(!url)("DM edits and messages (database)", async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const { and, eq } = await import("drizzle-orm");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { db, schema } = await import("@/db");
  const { buildPreset } = await import("@/presets");
  const dm = await import("./dmEdits");
  const msg = await import("./messages");
  const trades = await import("./trades");
  const { setContact } = await import("./contacts");
  const { audit } = await import("./audit");

  const ruleset = buildPreset("utterdark");
  const [itemA, itemB] = ruleset.items;
  const recipe = ruleset.recipes.find((r) => !r.knownAtStart)!;
  let gameId = "";
  let teamId = "";
  let otherId = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "drizzle" });
    const [game] = await db.insert(schema.games).values({ name: "DM edits test", currentRound: 1 }).returning();
    gameId = game.id;
    await db.insert(schema.gameRulesets).values({ gameId, data: ruleset });
    const code = () => `T${Math.random().toString(36).slice(2, 10)}`;
    const [a, b] = await db
      .insert(schema.teams)
      .values([
        { gameId, name: "Iron Clan", joinCode: code() },
        { gameId, name: "Red Hand", joinCode: code() },
      ])
      .returning();
    teamId = a.id;
    otherId = b.id;
  });

  afterAll(async () => {
    if (gameId) await db.delete(schema.games).where(eq(schema.games.id, gameId));
  });

  const qty = async (itemId: string) =>
    (await db.select().from(schema.inventory).where(and(eq(schema.inventory.teamId, teamId), eq(schema.inventory.itemId, itemId))))[0]?.qty ?? 0;
  const latest = async () => (await dm.loadDmChanges(gameId, teamId))[0];
  const thread = () => msg.loadThread(gameId, teamId);

  it("gives items, logs the change, sends the note, and undoes it", async () => {
    expect(await dm.editInventory(gameId, teamId, { [itemA.id]: 2 }, { send: true, text: `The DM gave you 2× ${itemA.name}` })).toBeNull();
    expect(await qty(itemA.id)).toBe(2);
    const change = await latest();
    expect(change).toMatchObject({ kind: "dm.inventory", undone: false });
    expect(change.description).toContain("Gave Iron Clan 2×");
    expect((await thread()).at(-1)).toMatchObject({ fromDm: true, authorName: "DM", kind: "note", body: `The DM gave you 2× ${itemA.name}` });

    expect(await dm.undoDmChange(gameId, teamId, change.id)).toBeNull();
    expect(await qty(itemA.id)).toBe(0);
    expect((await latest()).undone).toBe(true);
    expect(await dm.undoDmChange(gameId, teamId, change.id)).toMatch(/already been undone/);
  });

  it("doesn't send a note unless the box is ticked", async () => {
    const before = (await thread()).length;
    expect(await dm.editInventory(gameId, teamId, { [itemB.id]: 1 }, { send: false, text: "Not sent" })).toBeNull();
    expect((await thread()).length).toBe(before);
  });

  it("refuses an undo when something changed the same item since", async () => {
    expect(await dm.editInventory(gameId, teamId, { [itemA.id]: 5 })).toBeNull();
    const change = await latest();
    await db.update(schema.inventory).set({ qty: 4 }).where(and(eq(schema.inventory.teamId, teamId), eq(schema.inventory.itemId, itemA.id)));
    expect(await dm.undoDmChange(gameId, teamId, change.id)).toMatch(/changed since/);
    expect(await qty(itemA.id)).toBe(4);
  });

  it("refuses unknown items and changes that change nothing", async () => {
    expect(await dm.editInventory(gameId, teamId, { "no-such-item": 1 })).toBe("Unknown item.");
    expect(await dm.editInventory(gameId, teamId, { [itemA.id]: 4 })).toBe("Nothing changed.");
  });

  it("teaches and forgets recipes, with undo", async () => {
    const known = async () => (await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)))[0].knownRecipeIds;
    expect(await dm.editRecipes(gameId, teamId, { [recipe.id]: true })).toBeNull();
    expect(await known()).toContain(recipe.id);
    const taught = await latest();
    expect(taught.kind).toBe("dm.recipes");
    expect(await dm.undoDmChange(gameId, teamId, taught.id)).toBeNull();
    expect(await known()).not.toContain(recipe.id);
  });

  it("only lists and undoes this team's changes", async () => {
    expect(await dm.editInventory(gameId, otherId, { [itemA.id]: 1 })).toBeNull();
    const [theirs] = await dm.loadDmChanges(gameId, otherId);
    expect((await dm.loadDmChanges(gameId, teamId)).some((c) => c.id === theirs.id)).toBe(false);
    expect(await dm.undoDmChange(gameId, teamId, theirs.id)).toMatch(/wasn't found/);
  });

  it("logs a trade the DM proposes for the team, and undo takes it back", async () => {
    await setContact(gameId, teamId, otherId, true, 1);
    const get = { resources: { [ruleset.resources[0].id]: 1 }, items: {}, recipeIds: [], raceIds: [], unitIds: [], regionIds: [], map: false };
    const empty = { ...get, resources: {} };
    expect(await trades.proposeTrade(gameId, teamId, otherId, empty, get, "", { note: { send: true, text: "Proposed for you" } })).toBeNull();
    const change = await latest();
    expect(change).toMatchObject({ kind: "dm.trade.propose", description: "Proposed a trade to Red Hand for Iron Clan" });
    expect((await thread()).at(-1)?.body).toBe("Proposed for you");
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.gameId, gameId));
    expect(trade.status).toBe("proposed");
    expect(await dm.undoDmChange(gameId, teamId, change.id)).toBeNull();
    expect(await db.select().from(schema.trades).where(eq(schema.trades.gameId, gameId))).toEqual([]);
  });

  it("undoes the DM's answer to a trade, unless it has moved on", async () => {
    const get = { resources: { [ruleset.resources[0].id]: 1 }, items: {}, recipeIds: [], raceIds: [], unitIds: [], regionIds: [], map: false };
    const empty = { ...get, resources: {} };
    expect(await trades.proposeTrade(gameId, otherId, teamId, empty, get, "")).toBeNull();
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.gameId, gameId));
    expect(await trades.respondToTrade(gameId, teamId, trade.id, false, {})).toBeNull();
    const declined = await latest();
    expect(declined.kind).toBe("dm.trade.respond");
    expect(await dm.undoDmChange(gameId, teamId, declined.id)).toBeNull();
    const status = async () => (await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)))[0].status;
    expect(await status()).toBe("proposed");

    expect(await trades.cancelTrade(gameId, teamId, trade.id, {})).toBeNull();
    const cancelled = await latest();
    await db.update(schema.trades).set({ status: "executed" }).where(eq(schema.trades.id, trade.id));
    expect(await dm.undoDmChange(gameId, teamId, cancelled.id)).toMatch(/changed since/);
  });

  it("puts back the orders the DM replaced, unless the team saved again", async () => {
    const [round] = await db.insert(schema.rounds).values({ gameId, number: 1, status: "open" }).returning();
    const order = { roundId: round.id, teamId, position: 0, kind: "numbered", actionTypeId: ruleset.actionTypes[0].id, inputs: {}, notes: "theirs", status: "submitted" };
    await db.insert(schema.orders).values(order);
    await db.insert(schema.teamRoundOrders).values({ roundId: round.id, teamId, version: 1, submittedAt: new Date(), submittedBy: "Alice" });

    // What saveOrdersAction does for the DM: keep the old list, write the new one, log both.
    const save = async (notes: string) =>
      db.transaction(async (tx) => {
        const [state] = await tx.select().from(schema.teamRoundOrders).where(eq(schema.teamRoundOrders.teamId, teamId));
        const before = await dm.ordersStateFor(tx, round.id, teamId, state.version, state);
        await tx.delete(schema.orders).where(eq(schema.orders.teamId, teamId));
        await tx.insert(schema.orders).values({ ...order, notes, status: "draft" });
        await tx.update(schema.teamRoundOrders).set({ version: state.version + 1, submittedAt: null, submittedBy: null }).where(eq(schema.teamRoundOrders.teamId, teamId));
        await audit(tx, { gameId, actor: "dm", kind: "dm.orders", teamId, description: "Saved 1 orders", before, after: { roundId: round.id, version: state.version + 1, submittedAt: null, submittedBy: null } });
      });
    const orders = () => db.select().from(schema.orders).where(eq(schema.orders.teamId, teamId));
    const state = async () => (await db.select().from(schema.teamRoundOrders).where(eq(schema.teamRoundOrders.teamId, teamId)))[0];

    await save("the DM's");
    expect(await dm.undoDmChange(gameId, teamId, (await latest()).id)).toBeNull();
    expect((await orders()).map((o) => o.notes)).toEqual(["theirs"]);
    expect(await state()).toMatchObject({ version: 3, submittedBy: "Alice" });
    expect((await state()).submittedAt).not.toBeNull();

    await save("the DM's again");
    await db.update(schema.teamRoundOrders).set({ version: 99 }).where(eq(schema.teamRoundOrders.teamId, teamId));
    expect(await dm.undoDmChange(gameId, teamId, (await latest()).id)).toMatch(/changed since/);
  });

  it("counts unread messages for each side and clears them when read", async () => {
    await msg.markRead(gameId, teamId, "team");
    await msg.markRead(gameId, teamId, "dm");
    const team = async () => (await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)))[0];
    expect(await msg.postMessage(db, { gameId, teamId, fromDm: false, authorName: "Alice", text: "  Hello DM  " })).toBeNull();
    expect(await msg.postMessage(db, { gameId, teamId, fromDm: false, authorName: "Bob", text: "Are you there?" })).toBeNull();
    expect(await msg.postMessage(db, { gameId, teamId, fromDm: false, authorName: "Bob", text: "   " })).toBe("Write a message first.");
    expect(await msg.threadUnread(await team(), "dm")).toBe(2);
    expect(await msg.threadUnread(await team(), "team")).toBe(0);
    const inbox = await msg.dmInbox(gameId);
    expect(inbox.find((e) => e.team.id === teamId)).toMatchObject({ unread: 2, last: { authorName: "Bob", body: "Are you there?" } });
    expect(inbox.find((e) => e.team.id === otherId)?.unread).toBe(0);
    expect(await msg.dmUnreadTotal(gameId)).toBe(2);

    await msg.markRead(gameId, teamId, "dm");
    expect(await msg.threadUnread(await team(), "dm")).toBe(0);
    expect(await msg.postMessage(db, { gameId, teamId, fromDm: true, authorName: "DM", text: "Yes" })).toBeNull();
    expect(await msg.threadUnread(await team(), "team")).toBe(1);
    expect((await thread()).at(-3)?.body).toBe("Hello DM");
  });
});
