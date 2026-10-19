import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { Id } from "@/engine/ruleset/common";
import { describeBundle, isEmpty, type TradeBundle } from "@/engine/trades";
import { ACTIVE_STATUSES } from "@/engine/world/types";
import { audit } from "./audit";
import { contactsOf } from "./contacts";
import { loadRuleset } from "./rulesets";
import { loadGameRows, rowsToWorld } from "./world";

// Trades between teams that have met. Proposing, accepting, declining and
// cancelling happen here; executing happens at the end of the round
// (src/lib/resolution.ts), when both sides must still have what they offered.

const Amounts = z.record(Id, z.number().int().min(0).max(1_000_000));
export const Bundle = z.object({
  resources: Amounts.default({}),
  items: Amounts.default({}),
  recipeIds: z.array(Id).max(50).default([]),
  raceIds: z.array(Id).max(50).default([]),
  unitIds: z.array(z.uuid()).max(50).default([]),
  regionIds: z.array(z.uuid()).max(50).default([]),
  map: z.boolean().default(false),
});

const clean = (b: TradeBundle): TradeBundle => ({
  ...b,
  resources: Object.fromEntries(Object.entries(b.resources).filter(([, v]) => v > 0)),
  items: Object.fromEntries(Object.entries(b.items).filter(([, v]) => v > 0)),
});

export interface TradeView {
  id: string;
  round: number;
  direction: "out" | "in";
  otherTeam: { id: string; name: string; colour: string; emblem: string };
  give: string;
  get: string;
  message: string;
  status: string;
  result: string;
  executedRound: number | null;
}

/** A team's trades, newest first, described in words. Only the two teams in a trade ever see it. */
export async function loadTeamTrades(gameId: string, teamId: string): Promise<TradeView[]> {
  const rows = await db
    .select()
    .from(schema.trades)
    .where(and(eq(schema.trades.gameId, gameId), or(eq(schema.trades.fromTeamId, teamId), eq(schema.trades.toTeamId, teamId))))
    .orderBy(desc(schema.trades.createdAt));
  if (!rows.length) return [];
  const [{ ruleset }, gameRows] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId)]);
  const world = rowsToWorld(gameRows);
  return rows.map((t) => {
    const out = t.fromTeamId === teamId;
    const other = gameRows.teams.find((x) => x.id === (out ? t.toTeamId : t.fromTeamId));
    // "give" is always what this team hands over.
    return {
      id: t.id,
      round: t.round,
      direction: out ? "out" : "in",
      otherTeam: { id: other?.id ?? "", name: other?.name ?? "?", colour: other?.colour ?? "#888", emblem: other?.emblem ?? "" },
      give: describeBundle(ruleset, world, out ? t.give : t.get, "your"),
      get: describeBundle(ruleset, world, out ? t.get : t.give, `${other?.name ?? "their"}'s`),
      message: t.message,
      status: t.status,
      result: t.result,
      executedRound: t.executedRound,
    };
  });
}

/** Checks a team can offer a bundle now (it's checked again when the trade executes). */
async function checkOffer(gameId: string, teamId: string, b: TradeBundle): Promise<string | null> {
  const [{ ruleset }, rows] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId)]);
  const world = rowsToWorld(rows);
  const team = world.teams.find((t) => t.id === teamId)!;
  for (const [id, v] of Object.entries(b.resources)) {
    if (!ruleset.resources.some((x) => x.id === id)) return "Unknown resource.";
    if ((team.resources[id] ?? 0) < v) return `You only have ${team.resources[id] ?? 0} ${ruleset.resources.find((x) => x.id === id)?.name ?? id}.`;
  }
  for (const [id, q] of Object.entries(b.items)) if ((world.inventory[teamId]?.[id] ?? 0) < q) return `You don't have ${q}× ${ruleset.items.find((x) => x.id === id)?.name ?? id}.`;
  for (const id of b.recipeIds) if (!team.knownRecipeIds.includes(id) && !ruleset.recipes.find((x) => x.id === id)?.knownAtStart) return "You can only offer recipes you know.";
  for (const id of b.raceIds) if (id === team.baseRaceId || !team.raceIds.includes(id)) return "You can only offer races you've gained (not your base race).";
  for (const id of b.unitIds) {
    const u = world.units.find((x) => x.id === id);
    if (!u || u.ownerTeamId !== teamId || !ACTIVE_STATUSES.has(u.status)) return "You can only offer your own units.";
  }
  for (const id of b.regionIds) if (world.regions.find((x) => x.id === id)?.ownerTeamId !== teamId) return "You can only offer regions you own.";
  return null;
}

/** What a team may ask for: resources, items (any the rules know), recipes and races by name, and a map. */
function checkRequest(b: TradeBundle): string | null {
  if (b.unitIds.length || b.regionIds.length) return "Ask for units or regions in your message; the other team offers them in a counter-proposal.";
  return null;
}

export async function proposeTrade(gameId: string, fromTeamId: string, toTeamId: string, give: TradeBundle, get: TradeBundle, message: string): Promise<string | null> {
  if (fromTeamId === toTeamId) return "You can't trade with yourself.";
  if (!(await contactsOf(gameId, fromTeamId)).includes(toTeamId)) return "You can only trade with factions you've met.";
  give = clean(give);
  get = clean(get);
  if (isEmpty(give) && isEmpty(get)) return "Offer or ask for something.";
  const problem = (await checkOffer(gameId, fromTeamId, give)) ?? checkRequest(get);
  if (problem) return problem;
  const [game] = await db.select({ currentRound: schema.games.currentRound }).from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  const [row] = await db.insert(schema.trades).values({ gameId, fromTeamId, toTeamId, round: game?.currentRound ?? 0, give, get, message: message.slice(0, 2000) }).returning();
  await audit(db, { gameId, actor: fromTeamId, kind: "trade.propose", description: "Proposed a trade", after: row });
  return null;
}

async function tradeFor(gameId: string, tradeId: string) {
  const [t] = await db.select().from(schema.trades).where(and(eq(schema.trades.id, tradeId), eq(schema.trades.gameId, gameId))).limit(1);
  return t ?? null;
}

/** The receiving team accepts or declines a proposal. */
export async function respondToTrade(gameId: string, teamId: string, tradeId: string, accept: boolean): Promise<string | null> {
  const t = await tradeFor(gameId, tradeId);
  if (!t || t.toTeamId !== teamId) return "Trade not found.";
  if (t.status !== "proposed") return "That trade has already been answered.";
  if (accept) {
    const problem = await checkOffer(gameId, teamId, t.get);
    if (problem) return `You can't accept: ${problem}`;
  }
  await db
    .update(schema.trades)
    .set({ status: accept ? "accepted" : "declined", respondedAt: new Date() })
    .where(and(eq(schema.trades.id, t.id), eq(schema.trades.status, "proposed")));
  await audit(db, { gameId, actor: teamId, kind: `trade.${accept ? "accept" : "decline"}`, description: `${accept ? "Accepted" : "Declined"} a trade` });
  return null;
}

/** Either team calls off a trade that hasn't executed yet (the DM can too). */
export async function cancelTrade(gameId: string, actor: string | "dm", tradeId: string): Promise<string | null> {
  const t = await tradeFor(gameId, tradeId);
  if (!t || (actor !== "dm" && t.fromTeamId !== actor && t.toTeamId !== actor)) return "Trade not found.";
  if (t.status !== "proposed" && t.status !== "accepted") return "That trade can't be called off any more.";
  await db
    .update(schema.trades)
    .set({ status: "cancelled", respondedAt: t.respondedAt ?? new Date() })
    .where(and(eq(schema.trades.id, t.id), inArray(schema.trades.status, ["proposed", "accepted"])));
  await audit(db, { gameId, actor, kind: "trade.cancel", description: "Called off a trade" });
  return null;
}

/** Every trade in the game, for the DM. */
export async function loadAllTrades(gameId: string) {
  const rows = await db.select().from(schema.trades).where(eq(schema.trades.gameId, gameId)).orderBy(desc(schema.trades.createdAt));
  if (!rows.length) return [];
  const [{ ruleset }, gameRows] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId)]);
  const world = rowsToWorld(gameRows);
  const team = (id: string) => gameRows.teams.find((x) => x.id === id);
  return rows.map((t) => ({
    id: t.id,
    round: t.round,
    from: team(t.fromTeamId)?.name ?? "?",
    to: team(t.toTeamId)?.name ?? "?",
    give: describeBundle(ruleset, world, t.give, "its"),
    get: describeBundle(ruleset, world, t.get, "its"),
    message: t.message,
    status: t.status,
    result: t.result,
  }));
}
