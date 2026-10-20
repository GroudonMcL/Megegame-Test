import "server-only";
import { and, desc, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  applyRecipeChange,
  inventoryDescription,
  planInventoryEdit,
  planRecipeEdit,
  recipeDescription,
  recipeLabel,
  staleKeys,
  type InventoryChange,
  type RecipeChange,
} from "@/engine/dmEdits";
import type { TeamNote } from "@/engine/messages";
import { audit } from "./audit";
import { sendDmNote } from "./messages";
import { loadRuleset } from "./rulesets";

// Changes the DM makes to a team from "view as team". Each one is written to
// the audit log (kind "dm.…", with the team) with enough before/after to undo
// it, and can send a note to the team. Undo puts back the "before", but only
// if nothing has changed the same things since.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lockTeam = (tx: Tx, gameId: string, teamId: string) =>
  tx
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId)))
    .for("update")
    .then((r) => r[0]);

async function inventoryOf(tx: Tx, teamId: string): Promise<Record<string, number>> {
  const rows = await tx.select().from(schema.inventory).where(eq(schema.inventory.teamId, teamId));
  return Object.fromEntries(rows.map((r) => [r.itemId, r.qty]));
}

async function setItems(tx: Tx, teamId: string, items: Record<string, number>) {
  for (const [itemId, qty] of Object.entries(items)) {
    if (qty > 0) {
      await tx.insert(schema.inventory).values({ teamId, itemId, qty }).onConflictDoUpdate({ target: [schema.inventory.teamId, schema.inventory.itemId], set: { qty } });
    } else {
      await tx.delete(schema.inventory).where(and(eq(schema.inventory.teamId, teamId), eq(schema.inventory.itemId, itemId)));
    }
  }
}

const namer = (items: { id: string; name: string }[]) => (id: string) => items.find((x) => x.id === id)?.name ?? id;

/** The DM sets item quantities in a team's inventory (0 removes the item). */
export async function editInventory(gameId: string, teamId: string, wanted: Record<string, number>, note?: TeamNote): Promise<string | null> {
  const { ruleset } = await loadRuleset(gameId);
  const known = new Set(ruleset.items.map((i) => i.id));
  if (Object.keys(wanted).some((id) => !known.has(id))) return "Unknown item.";
  const itemName = namer(ruleset.items);
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, gameId, teamId);
    if (!team) return "Team not found.";
    const change = planInventoryEdit(await inventoryOf(tx, teamId), wanted);
    if (!change) return "Nothing changed.";
    await setItems(tx, teamId, change.after);
    const description = inventoryDescription(change, itemName, team.name);
    await audit(tx, { gameId, actor: "dm", kind: "dm.inventory", teamId, description, before: change.before, after: change.after });
    await sendDmNote(tx, gameId, teamId, note);
    return null;
  });
}

/** The DM teaches (true) or makes a team forget (false) recipes. */
export async function editRecipes(gameId: string, teamId: string, wanted: Record<string, boolean>, note?: TeamNote): Promise<string | null> {
  const { ruleset } = await loadRuleset(gameId);
  const recipes = new Map(ruleset.recipes.map((r) => [r.id, r]));
  if (Object.keys(wanted).some((id) => !recipes.has(id))) return "Unknown recipe.";
  const atStart = new Set(ruleset.recipes.filter((r) => r.knownAtStart).map((r) => r.id));
  const name = (id: string) => recipeLabel(recipes.get(id) ?? { outputs: [] }, namer(ruleset.items)) || id;
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, gameId, teamId);
    if (!team) return "Team not found.";
    const change = planRecipeEdit(team.knownRecipeIds, wanted, atStart);
    if (!change) return "Nothing changed.";
    await tx.update(schema.teams).set({ knownRecipeIds: applyRecipeChange(team.knownRecipeIds, change.after) }).where(eq(schema.teams.id, teamId));
    const description = recipeDescription(change, name, team.name);
    await audit(tx, { gameId, actor: "dm", kind: "dm.recipes", teamId, description, before: change.before, after: change.after });
    await sendDmNote(tx, gameId, teamId, note);
    return null;
  });
}

export interface DmChangeView {
  id: string;
  kind: string;
  description: string;
  createdAt: string;
  undone: boolean;
}

/** The DM's changes to one team, newest first. */
export async function loadDmChanges(gameId: string, teamId: string, limit = 100): Promise<DmChangeView[]> {
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.gameId, gameId), eq(schema.auditLog.teamId, teamId), like(schema.auditLog.kind, "dm.%")))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind, description: r.description, createdAt: r.createdAt.toISOString(), undone: r.undone }));
}

// ——— What each kind of change stores, and how it's undone ———

/** dm.rename */
export interface RenameState {
  unitId: string;
  name: string;
}

/** dm.orders: the team's order list for a round. */
export interface OrdersState {
  roundId: string;
  version: number;
  submittedAt: string | null;
  submittedBy: string | null;
  /** The order rows (only in "before"; "after" needs just the version). */
  orders?: (Omit<typeof schema.orders.$inferSelect, "updatedAt"> & { updatedAt: string })[];
}

/** dm.trade.*: the trade's status (null = the trade didn't exist yet). */
export type TradeState = { id: string; status: string; respondedAt: string | null } | null;

/** Undoes one DM change to a team. Returns an error, or null when done. */
export async function undoDmChange(gameId: string, teamId: string, auditId: string, note?: TeamNote): Promise<string | null> {
  const { ruleset } = await loadRuleset(gameId);
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, gameId, teamId);
    if (!team) return "Team not found.";
    const [entry] = await tx
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.id, auditId), eq(schema.auditLog.gameId, gameId), eq(schema.auditLog.teamId, teamId), like(schema.auditLog.kind, "dm.%")))
      .for("update");
    if (!entry) return "That change wasn't found.";
    if (entry.undone) return "That change has already been undone.";
    const problem = await undoOne(tx, gameId, teamId, entry.kind, entry.before, entry.after, ruleset.items);
    if (problem) return problem;
    await tx.update(schema.auditLog).set({ undone: true }).where(eq(schema.auditLog.id, entry.id));
    await audit(tx, { gameId, actor: "dm", kind: "undo", teamId, description: `Undid: ${entry.description}`, before: { auditId: entry.id } });
    await sendDmNote(tx, gameId, teamId, note);
    return null;
  });
}

async function undoOne(tx: Tx, gameId: string, teamId: string, kind: string, before: unknown, after: unknown, items: { id: string; name: string }[]): Promise<string | null> {
  const since = "has changed since, so this can't be undone. Make the change by hand instead.";
  switch (kind) {
    case "dm.inventory": {
      const c = { before, after } as InventoryChange;
      const stale = staleKeys(c.after, await inventoryOf(tx, teamId), 0);
      if (stale.length) return `${stale.map(namer(items)).join(", ")} ${since}`;
      await setItems(tx, teamId, c.before);
      return null;
    }
    case "dm.recipes": {
      const c = { before, after } as RecipeChange;
      const [team] = await tx.select({ known: schema.teams.knownRecipeIds }).from(schema.teams).where(eq(schema.teams.id, teamId));
      const current = Object.fromEntries(Object.keys(c.after).map((id) => [id, team.known.includes(id)]));
      if (staleKeys(c.after, current, false).length) return `What this team knows ${since}`;
      await tx.update(schema.teams).set({ knownRecipeIds: applyRecipeChange(team.known, c.before) }).where(eq(schema.teams.id, teamId));
      return null;
    }
    case "dm.rename": {
      const b = before as RenameState;
      const a = after as RenameState;
      const rows = await tx
        .update(schema.units)
        .set({ name: b.name })
        .where(and(eq(schema.units.id, a.unitId), eq(schema.units.ownerTeamId, teamId), eq(schema.units.gameId, gameId), eq(schema.units.name, a.name)))
        .returning({ id: schema.units.id });
      return rows.length ? null : `The unit's name ${since}`;
    }
    case "dm.orders":
      return undoOrders(tx, teamId, before as OrdersState, after as OrdersState, since);
    case "dm.trade.propose":
    case "dm.trade.respond":
    case "dm.trade.cancel":
      return undoTrade(tx, gameId, before as TradeState, after as TradeState, since);
    default:
      return "This kind of change can't be undone.";
  }
}

async function undoOrders(tx: Tx, teamId: string, before: OrdersState, after: OrdersState, since: string): Promise<string | null> {
  const [round] = await tx.select().from(schema.rounds).where(eq(schema.rounds.id, after.roundId)).for("update");
  if (!round || (round.status !== "open" && round.status !== "locked")) return "The round has moved on, so these orders can't be put back.";
  const [state] = await tx
    .select()
    .from(schema.teamRoundOrders)
    .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, teamId)))
    .for("update");
  if (!state || state.version !== after.version) return `The orders ${since}`;
  await tx.delete(schema.orders).where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, teamId)));
  const rows = before.orders ?? [];
  if (rows.length) await tx.insert(schema.orders).values(rows.map((o) => ({ ...o, updatedAt: new Date(o.updatedAt) })));
  await tx
    .update(schema.teamRoundOrders)
    .set({
      // A new version, so open order windows reload instead of saving over this.
      version: state.version + 1,
      submittedAt: before.submittedAt ? new Date(before.submittedAt) : null,
      submittedBy: before.submittedBy,
      updatedAt: new Date(),
      updatedBy: "DM",
    })
    .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, teamId)));
  return null;
}

async function undoTrade(tx: Tx, gameId: string, before: TradeState, after: TradeState, since: string): Promise<string | null> {
  if (!after) return "That change wasn't found.";
  const [trade] = await tx
    .select()
    .from(schema.trades)
    .where(and(eq(schema.trades.id, after.id), eq(schema.trades.gameId, gameId)))
    .for("update");
  if (!trade || trade.status !== after.status) return `The trade ${since}`;
  if (!before) await tx.delete(schema.trades).where(eq(schema.trades.id, trade.id));
  else await tx.update(schema.trades).set({ status: before.status, respondedAt: before.respondedAt ? new Date(before.respondedAt) : null }).where(eq(schema.trades.id, trade.id));
  return null;
}

/** The current round's order rows for a team, as stored in a dm.orders "before". */
export async function ordersStateFor(tx: Tx, roundId: string, teamId: string, version: number, state: { submittedAt: Date | null; submittedBy: string | null } | undefined): Promise<OrdersState> {
  const rows = await tx.select().from(schema.orders).where(and(eq(schema.orders.roundId, roundId), eq(schema.orders.teamId, teamId)));
  return {
    roundId,
    version,
    submittedAt: state?.submittedAt?.toISOString() ?? null,
    submittedBy: state?.submittedBy ?? null,
    orders: rows.map((o) => ({ ...o, updatedAt: o.updatedAt.toISOString() })),
  };
}
