import "server-only";
import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ResourceAmounts } from "@/engine/ruleset/common";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { OrderDraft } from "@/engine/orders/validate";
import { addTo } from "@/engine/orders/economy";
import { endOfRound, type RoundEnd } from "@/engine/resolve/endOfRound";
import type { TradeInput } from "@/engine/trades";
import { buildQueue, interactionFlags, scenes, type Flag } from "@/engine/resolve/queue";
import { orderCombatOdds, resolveOrder, type CombatOptions } from "@/engine/resolve/resolveOrder";
import type { CombatOdds } from "@/engine/combat/types";
import type { Change, Proposal, RollRecord, World } from "@/engine/resolve/types";
import { recordMeetings } from "./contacts";
import { loadRuleset } from "./rulesets";
import { loadGameRows, rowsToWorld } from "./world";

// Resolving a round on the server. Every change to the game goes through
// applyChanges, inside a transaction, with an audit entry holding the rows as
// they were before, so the DM can undo the most recent steps.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type OrderRow = typeof schema.orders.$inferSelect;
type RoundRow = typeof schema.rounds.$inferSelect;

/** What's stored in orders.outcome while the DM works through the queue. */
export interface OrderOutcome {
  seed: string;
  rerolls: number;
  proposal: Proposal;
  /** Outcome text for the team; starts as the drafted text and the DM can edit it. */
  text: string;
  /** Extra resource changes the DM adds. */
  adjust: ResourceAmounts;
  hideRolls: boolean;
  /** What the team gained or lost, once resolved. */
  delta?: ResourceAmounts;
  /** The DM's choices for this order's fights. */
  combat?: FightSettings;
  /** "Show odds" results, one per fight (cleared when the fight changes). */
  odds?: CombatOdds[];
}

export interface FightSettings extends CombatOptions {
  /** Show the round-by-round log to the teams in the fight (default yes). */
  shareLog?: boolean;
}

/** What's stored in rounds.end_of_round. */
export interface EndOfRoundState {
  seed: string;
  result: RoundEnd;
  /** teamId → extra resource changes the DM adds. */
  adjust: Record<string, ResourceAmounts>;
  applied: boolean;
  /** The random-event table rolled for which teams, if any. */
  events?: { tableId: string; teamIds: string[] } | null;
}

export const PENDING = new Set(["draft", "submitted", "prepared"]);
export const DONE = new Set(["resolved", "failed", "skipped"]);

export async function currentRound(gameId: string, tx: Pick<typeof db, "select"> = db) {
  const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) throw new Error("Game not found");
  const [round] = await tx
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.currentRound)))
    .limit(1);
  return { game, round: round ?? null };
}

async function lockRound(tx: Tx, roundId: string) {
  await tx.select({ id: schema.rounds.id }).from(schema.rounds).where(eq(schema.rounds.id, roundId)).for("update");
}

function toDraft(o: OrderRow): OrderDraft {
  return { id: o.id, kind: o.kind as OrderDraft["kind"], actionTypeId: o.actionTypeId, inputs: o.inputs, notes: o.notes };
}

// ——— Applying changes ———

interface Before {
  units: (typeof schema.units.$inferSelect)[];
  regions: (typeof schema.regions.$inferSelect)[];
  teams: { id: string; resources: ResourceAmounts; knownRecipeIds: string[]; raceIds?: string[] }[];
  inventory: { teamId: string; itemId: string; qty: number | null }[];
  createdUnitIds: string[];
  /** Detections of the units a change touched, as they were. */
  detections?: { teamId: string; unitId: string; round: number }[];
  /** Units whose detections a change touched (so new ones can be removed on undo). */
  detectionUnitIds?: string[];
  /** Trades the end of round executed or failed, as they were. */
  trades?: { id: string; status: string; result: string; executedRound: number | null }[];
  /** Map knowledge of teams that received a map in a trade, as it was. */
  knowledge?: { teamId: string; regions: (typeof schema.teamRegionKnowledge.$inferSelect)[]; connections: (typeof schema.teamConnectionKnowledge.$inferSelect)[] }[];
  /** Units whose movement and ability uses were reset (end of round). */
  resetUnits?: { id: string; milesUsed: number; usesSpent: Record<string, number> }[];
}

async function captureBefore(tx: Tx, gameId: string, changes: Change[]): Promise<Before> {
  const unitIds = [...new Set(changes.flatMap((c) => (c.type === "moveUnit" || c.type === "updateUnit" ? [c.unitId] : [])))];
  const regionIds = [...new Set(changes.flatMap((c) => (c.type === "updateRegion" ? [c.regionId] : [])))];
  const teamIds = [...new Set(changes.flatMap((c) => (c.type === "resources" || c.type === "learnRecipes" || c.type === "gainRaces" ? [c.teamId] : [])))];
  const invKeys = [...new Map(changes.flatMap((c) => (c.type === "inventory" ? [[`${c.teamId}:${c.itemId}`, c] as const] : []))).values()];
  const [units, regions, teams] = await Promise.all([
    unitIds.length ? tx.select().from(schema.units).where(and(eq(schema.units.gameId, gameId), inArray(schema.units.id, unitIds))) : [],
    regionIds.length ? tx.select().from(schema.regions).where(and(eq(schema.regions.gameId, gameId), inArray(schema.regions.id, regionIds))) : [],
    teamIds.length
      ? tx
          .select({ id: schema.teams.id, resources: schema.teams.resources, knownRecipeIds: schema.teams.knownRecipeIds, raceIds: schema.teams.raceIds })
          .from(schema.teams)
          .where(and(eq(schema.teams.gameId, gameId), inArray(schema.teams.id, teamIds)))
      : [],
  ]);
  const inventory: Before["inventory"] = [];
  for (const c of invKeys) {
    const [row] = await tx
      .select()
      .from(schema.inventory)
      .where(and(eq(schema.inventory.teamId, c.teamId), eq(schema.inventory.itemId, c.itemId)));
    inventory.push({ teamId: c.teamId, itemId: c.itemId, qty: row?.qty ?? null });
  }
  const detectionUnitIds = [...new Set(changes.flatMap((c) => (c.type === "detectUnits" || c.type === "clearDetections" ? c.unitIds : [])))];
  const detections = detectionUnitIds.length ? await tx.select().from(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.unitId, detectionUnitIds)) : [];
  return { units, regions, teams, inventory, detections, detectionUnitIds, createdUnitIds: changes.flatMap((c) => (c.type === "createUnit" ? [c.unit.id] : [])) };
}

/** Writes changes to the database. Every row is scoped to the game. */
async function applyChanges(tx: Tx, gameId: string, changes: Change[]) {
  const teamRow = async (teamId: string) => {
    const [t] = await tx.select().from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId)));
    if (!t) throw new Error("A change refers to a team outside this game");
    return t;
  };
  for (const c of changes) {
    switch (c.type) {
      case "resources": {
        const t = await teamRow(c.teamId);
        const resources = { ...t.resources };
        addTo(resources, c.delta);
        await tx.update(schema.teams).set({ resources }).where(eq(schema.teams.id, t.id));
        break;
      }
      case "learnRecipes": {
        const t = await teamRow(c.teamId);
        await tx
          .update(schema.teams)
          .set({ knownRecipeIds: [...new Set([...t.knownRecipeIds, ...c.recipeIds])] })
          .where(eq(schema.teams.id, t.id));
        break;
      }
      case "gainRaces": {
        const t = await teamRow(c.teamId);
        await tx
          .update(schema.teams)
          .set({ raceIds: [...new Set([...t.raceIds, ...c.raceIds])] })
          .where(eq(schema.teams.id, t.id));
        break;
      }
      case "detectUnits": {
        await teamRow(c.teamId);
        const own = await tx.select({ id: schema.units.id }).from(schema.units).where(and(eq(schema.units.gameId, gameId), inArray(schema.units.id, c.unitIds)));
        if (own.length) {
          await tx
            .insert(schema.teamUnitDetections)
            .values(own.map((u) => ({ teamId: c.teamId, unitId: u.id, round: c.round })))
            .onConflictDoNothing();
        }
        break;
      }
      case "clearDetections": {
        const own = await tx.select({ id: schema.units.id }).from(schema.units).where(and(eq(schema.units.gameId, gameId), inArray(schema.units.id, c.unitIds)));
        if (own.length) await tx.delete(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.unitId, own.map((u) => u.id)));
        break;
      }
      case "moveUnit":
        await tx
          .update(schema.units)
          .set({ regionId: c.regionId, milesUsed: c.milesUsed })
          .where(and(eq(schema.units.id, c.unitId), eq(schema.units.gameId, gameId)));
        break;
      case "updateUnit":
        await tx.update(schema.units).set(c.patch).where(and(eq(schema.units.id, c.unitId), eq(schema.units.gameId, gameId)));
        break;
      case "createUnit":
        await tx.insert(schema.units).values({ ...c.unit, gameId });
        break;
      case "updateRegion":
        await tx.update(schema.regions).set(c.patch).where(and(eq(schema.regions.id, c.regionId), eq(schema.regions.gameId, gameId)));
        break;
      case "inventory": {
        await teamRow(c.teamId);
        const [row] = await tx.select().from(schema.inventory).where(and(eq(schema.inventory.teamId, c.teamId), eq(schema.inventory.itemId, c.itemId)));
        const qty = (row?.qty ?? 0) + c.delta;
        if (qty <= 0) await tx.delete(schema.inventory).where(and(eq(schema.inventory.teamId, c.teamId), eq(schema.inventory.itemId, c.itemId)));
        else if (row) await tx.update(schema.inventory).set({ qty }).where(and(eq(schema.inventory.teamId, c.teamId), eq(schema.inventory.itemId, c.itemId)));
        else await tx.insert(schema.inventory).values({ teamId: c.teamId, itemId: c.itemId, qty });
        break;
      }
    }
  }
}

async function restore(tx: Tx, gameId: string, before: Before) {
  for (const id of before.createdUnitIds) await tx.delete(schema.units).where(and(eq(schema.units.id, id), eq(schema.units.gameId, gameId)));
  for (const u of before.units) {
    const { id, regionId, milesUsed, status, hp, augmentIds, academyBonus, name, usesSpent, ownerTeamId } = u;
    await tx.update(schema.units).set({ regionId, milesUsed, status, hp, augmentIds, academyBonus, name, usesSpent, ownerTeamId }).where(and(eq(schema.units.id, id), eq(schema.units.gameId, gameId)));
  }
  if (before.detections) {
    const ids = [...new Set([...before.detections.map((d) => d.unitId), ...(before.detectionUnitIds ?? [])])];
    if (ids.length) await tx.delete(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.unitId, ids));
    if (before.detections.length) await tx.insert(schema.teamUnitDetections).values(before.detections).onConflictDoNothing();
  }
  for (const t of before.trades ?? []) {
    await tx.update(schema.trades).set({ status: t.status, result: t.result, executedRound: t.executedRound }).where(and(eq(schema.trades.id, t.id), eq(schema.trades.gameId, gameId)));
  }
  for (const k of before.knowledge ?? []) {
    await tx.delete(schema.teamRegionKnowledge).where(eq(schema.teamRegionKnowledge.teamId, k.teamId));
    await tx.delete(schema.teamConnectionKnowledge).where(eq(schema.teamConnectionKnowledge.teamId, k.teamId));
    if (k.regions.length) await tx.insert(schema.teamRegionKnowledge).values(k.regions);
    if (k.connections.length) await tx.insert(schema.teamConnectionKnowledge).values(k.connections);
  }
  for (const u of before.resetUnits ?? []) {
    await tx.update(schema.units).set({ milesUsed: u.milesUsed, usesSpent: u.usesSpent }).where(and(eq(schema.units.id, u.id), eq(schema.units.gameId, gameId)));
  }
  for (const r of before.regions) {
    const { id, ownerTeamId, settlementTierId, buildings } = r;
    await tx.update(schema.regions).set({ ownerTeamId, settlementTierId, buildings }).where(and(eq(schema.regions.id, id), eq(schema.regions.gameId, gameId)));
  }
  for (const t of before.teams) {
    await tx.update(schema.teams).set({ resources: t.resources, knownRecipeIds: t.knownRecipeIds, ...(t.raceIds ? { raceIds: t.raceIds } : {}) }).where(and(eq(schema.teams.id, t.id), eq(schema.teams.gameId, gameId)));
  }
  for (const i of before.inventory) {
    await tx.delete(schema.inventory).where(and(eq(schema.inventory.teamId, i.teamId), eq(schema.inventory.itemId, i.itemId)));
    if (i.qty !== null) await tx.insert(schema.inventory).values({ teamId: i.teamId, itemId: i.itemId, qty: i.qty });
  }
}

/** Gives one team everything another knows of the map: regions it has found or seen, and hidden passages. */
async function shareMap(tx: Tx, gameId: string, fromTeamId: string, toTeamId: string, roundNumber: number) {
  const teams = await tx.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.gameId, gameId), inArray(schema.teams.id, [fromTeamId, toTeamId])));
  if (teams.length !== 2) return;
  const [theirs, mine, theirConnections] = await Promise.all([
    tx.select().from(schema.teamRegionKnowledge).where(eq(schema.teamRegionKnowledge.teamId, fromTeamId)),
    tx.select().from(schema.teamRegionKnowledge).where(eq(schema.teamRegionKnowledge.teamId, toTeamId)),
    tx.select().from(schema.teamConnectionKnowledge).where(eq(schema.teamConnectionKnowledge.teamId, fromTeamId)),
  ]);
  for (const k of theirs) {
    if (!k.discovered && !k.lastSeen) continue;
    const own = mine.find((x) => x.regionId === k.regionId);
    const newer = k.lastSeen && (own?.lastSeenRound ?? -1) < (k.lastSeenRound ?? roundNumber);
    const values = {
      teamId: toTeamId,
      regionId: k.regionId,
      discovered: true,
      searched: own?.searched ?? false,
      permanentVision: own?.permanentVision ?? false,
      lastSeen: newer ? k.lastSeen : (own?.lastSeen ?? null),
      lastSeenRound: newer ? k.lastSeenRound : (own?.lastSeenRound ?? null),
    };
    await tx
      .insert(schema.teamRegionKnowledge)
      .values(values)
      .onConflictDoUpdate({ target: [schema.teamRegionKnowledge.teamId, schema.teamRegionKnowledge.regionId], set: values });
  }
  if (theirConnections.length) {
    await tx
      .insert(schema.teamConnectionKnowledge)
      .values(theirConnections.map((c) => ({ teamId: toTeamId, connectionId: c.connectionId })))
      .onConflictDoNothing();
  }
}

async function logRolls(tx: Tx, gameId: string, roundId: string, orderId: string | null, rolls: RollRecord[], hidden: boolean) {
  if (!rolls.length) return;
  await tx.insert(schema.rollLog).values(
    rolls.map((r) => ({
      gameId,
      roundId,
      orderId,
      label: r.label,
      expression: r.expression,
      seed: r.seed,
      result: { breakdown: r.breakdown, outcome: r.outcome },
      total: r.total,
      tableId: r.tableId,
      hiddenFromPlayers: hidden,
    })),
  );
}

function resourceDelta(changes: Change[], teamId: string): ResourceAmounts {
  const out: ResourceAmounts = {};
  for (const c of changes) if (c.type === "resources" && c.teamId === teamId) addTo(out, c.delta);
  return out;
}

// ——— The round lifecycle ———

/** Lock (if still open) and freeze the state players see, then start the queue. */
export async function startResolving(gameId: string) {
  await db.transaction(async (tx) => {
    const { round } = await currentRound(gameId, tx);
    if (!round || (round.status !== "open" && round.status !== "locked")) return;
    await lockRound(tx, round.id);
    const snapshot = await loadGameRows(gameId, tx);
    await tx
      .update(schema.rounds)
      .set({ status: "resolving", lockedAt: round.lockedAt ?? new Date(), startSnapshot: snapshot })
      .where(eq(schema.rounds.id, round.id));
    await tx.insert(schema.auditLog).values({ gameId, roundId: round.id, actor: "dm", kind: "round.resolve", description: `Started resolving round ${round.number}` });
  });
}

export interface QueueItem {
  order: OrderRow;
  teamName: string;
  teamColour: string;
  submitted: boolean;
  outcome: OrderOutcome | null;
  /** For a backup order: waiting on its parent, active, or not needed. */
  backup: "waiting" | "active" | "notNeeded" | null;
  scene: number | null;
}

export interface QueueStepView {
  step: number;
  items: QueueItem[];
  flags: Flag[];
  pending: number;
}

export async function loadQueue(gameId: string): Promise<{ round: RoundRow | null; steps: QueueStepView[]; ruleset: Ruleset; world: World }> {
  const [{ round }, { ruleset }, rows] = await Promise.all([currentRound(gameId), loadRuleset(gameId), loadGameRows(gameId)]);
  const world = rowsToWorld(rows);
  if (!round) return { round, steps: [], ruleset, world };
  const [orders, states] = await Promise.all([
    db.select().from(schema.orders).where(eq(schema.orders.roundId, round.id)).orderBy(asc(schema.orders.position)),
    db.select().from(schema.teamRoundOrders).where(eq(schema.teamRoundOrders.roundId, round.id)),
  ]);
  const teamOrder = rows.teams.map((t) => t.id);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const steps = buildQueue(orders, teamOrder).map((s) => {
    const items: QueueItem[] = s.items.map((o) => {
      const team = rows.teams.find((t) => t.id === o.teamId);
      const parent = o.parentOrderId ? byId.get(o.parentOrderId) : undefined;
      const backup = o.kind !== "conditional" ? null : parent?.status === "failed" ? "active" : parent && DONE.has(parent.status) ? "notNeeded" : "waiting";
      return {
        order: o,
        teamName: team?.name ?? "?",
        teamColour: team?.colour ?? "#888",
        submitted: Boolean(states.find((x) => x.teamId === o.teamId)?.submittedAt),
        outcome: (o.outcome as OrderOutcome | null) ?? null,
        backup,
        scene: null,
      };
    });
    const flags = interactionFlags(
      items.filter((i) => !DONE.has(i.order.status) && i.backup !== "notNeeded").map((i) => ({ id: i.order.id, teamId: i.order.teamId, proposal: i.outcome?.proposal ?? null })),
      world,
    );
    const sceneOf = scenes(flags);
    for (const i of items) i.scene = sceneOf.get(i.order.id) ?? null;
    return { step: s.step, items, flags, pending: items.filter((i) => !DONE.has(i.order.status) && i.backup !== "notNeeded").length };
  });
  return { round, steps, ruleset, world };
}

/** Pre-resolves every undecided order in a step against the current state. */
export async function prepareStep(gameId: string, step: number) {
  const { steps, ruleset, world, round } = await loadQueue(gameId);
  if (!round || round.status !== "resolving") return;
  const s = steps.find((x) => x.step === step);
  if (!s) return;
  for (const item of s.items) {
    const o = item.order;
    if (DONE.has(o.status) || item.backup === "waiting") continue;
    if (item.backup === "notNeeded") {
      await db.update(schema.orders).set({ status: "skipped", outcome: { ...(item.outcome ?? {}), text: "Not needed: the action before it succeeded." } }).where(eq(schema.orders.id, o.id));
      continue;
    }
    await prepareOne(o, ruleset, world, round.number, item.outcome);
  }
}

async function prepareOne(o: OrderRow, ruleset: Ruleset, world: World, roundNumber: number, previous: OrderOutcome | null, reroll = false) {
  const rerolls = (previous?.rerolls ?? 0) + (reroll ? 1 : 0);
  const seed = `${o.id}:${rerolls}`;
  // A re-roll is a fresh fight: the DM's hand-set results no longer apply.
  const combat = reroll && previous?.combat ? { ...previous.combat, overrides: undefined } : previous?.combat;
  const proposal = resolveOrder({ ruleset, world, teamId: o.teamId, order: toDraft(o), round: roundNumber, seed, combat });
  const outcome: OrderOutcome = {
    seed,
    rerolls,
    proposal,
    text: proposal.text,
    adjust: previous?.adjust ?? {},
    hideRolls: previous?.hideRolls ?? false,
    combat,
  };
  await db.update(schema.orders).set({ status: "prepared", outcome }).where(eq(schema.orders.id, o.id));
}

async function orderInRound(gameId: string, orderId: string) {
  const { round } = await currentRound(gameId);
  if (!round || round.status !== "resolving") throw new Error("The round isn't being resolved.");
  const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.roundId, round.id))).limit(1);
  if (!o) throw new Error("Order not found in this round.");
  return { round, order: o };
}

export async function rerollOrder(gameId: string, orderId: string) {
  const { round, order } = await orderInRound(gameId, orderId);
  if (DONE.has(order.status)) throw new Error("That order has already been decided. Undo it first.");
  const [{ ruleset }, rows] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId)]);
  await prepareOne(order, ruleset, rowsToWorld(rows), round.number, (order.outcome as OrderOutcome | null) ?? null, true);
}

/** Changes how this order's fights are run (focus targets, by hand, sharing the log) and works it out again with the same dice. */
export async function setFightSettings(gameId: string, orderId: string, settings: FightSettings) {
  const { round, order } = await orderInRound(gameId, orderId);
  if (DONE.has(order.status)) throw new Error("That order has already been decided. Undo it first.");
  const previous = (order.outcome as OrderOutcome | null) ?? null;
  if (!previous) throw new Error("Prepare the step first.");
  const [{ ruleset }, rows] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId)]);
  const world = rowsToWorld(rows);
  const live = new Set(world.units.map((u) => u.id));
  const priority = Object.fromEntries(Object.entries(settings.priority ?? {}).filter(([, id]) => live.has(id)));
  const overrides = Object.fromEntries(Object.entries(settings.overrides ?? {}).filter(([id]) => live.has(id)));
  const combat: FightSettings = { priority, byHand: Boolean(settings.byHand), shareLog: settings.shareLog !== false, overrides };
  const proposal = resolveOrder({ ruleset, world, teamId: order.teamId, order: toDraft(order), round: round.number, seed: previous.seed, combat });
  // Keep the DM's own wording unless it was the drafted text.
  const text = previous.text === previous.proposal.text ? proposal.text : previous.text;
  const outcome: OrderOutcome = { ...previous, proposal, text, combat, odds: undefined };
  await db.update(schema.orders).set({ outcome }).where(eq(schema.orders.id, order.id));
}

/** Runs this order's fights many times to show how they tend to go. */
export async function computeOdds(gameId: string, orderId: string) {
  const { round, order } = await orderInRound(gameId, orderId);
  const previous = (order.outcome as OrderOutcome | null) ?? null;
  if (!previous?.proposal.combats?.length) throw new Error("This order has no fight.");
  const [{ ruleset }, rows] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId)]);
  const odds = orderCombatOdds({ ruleset, world: rowsToWorld(rows), teamId: order.teamId, order: toDraft(order), round: round.number, seed: previous.seed, combat: previous.combat });
  await db.update(schema.orders).set({ outcome: { ...previous, odds } }).where(eq(schema.orders.id, order.id));
}

export interface Decision {
  text: string;
  adjust: ResourceAmounts;
  hideRolls: boolean;
}

/**
 * Accepts an order: re-resolves it with the same seed against the state as it
 * is now (so earlier decisions are taken into account), then applies it.
 */
export async function acceptOrder(gameId: string, orderId: string, d: Decision): Promise<{ ok: true } | { ok: false; error: string }> {
  const { round, order } = await orderInRound(gameId, orderId);
  if (DONE.has(order.status)) return { ok: false, error: "That order has already been decided." };
  const previous = order.outcome as OrderOutcome | null;
  if (!previous) return { ok: false, error: "Prepare the step first." };
  const { ruleset } = await loadRuleset(gameId);
  return db.transaction(async (tx) => {
    await lockRound(tx, round.id);
    const world = rowsToWorld(await loadGameRows(gameId, tx));
    const proposal = resolveOrder({ ruleset, world, teamId: order.teamId, order: toDraft(order), round: round.number, seed: previous.seed, combat: previous.combat });
    if (proposal.status === "invalid") {
      await tx.update(schema.orders).set({ outcome: { ...previous, proposal } }).where(eq(schema.orders.id, order.id));
      return { ok: false as const, error: `It can no longer happen: ${proposal.problems[0]} Mark it as failed, or adjust it by hand.` };
    }
    const changes: Change[] = [...proposal.changes];
    if (Object.values(d.adjust).some((v) => v)) changes.push({ type: "resources", teamId: order.teamId, delta: d.adjust });
    const before = await captureBefore(tx, gameId, changes);
    await applyChanges(tx, gameId, changes);
    const delta = resourceDelta(changes, order.teamId);
    const outcome: OrderOutcome = { ...previous, proposal, text: d.text, adjust: d.adjust, hideRolls: d.hideRolls, delta };
    await tx.update(schema.orders).set({ status: "resolved", outcome }).where(eq(schema.orders.id, order.id));
    await logRolls(tx, gameId, round.id, order.id, proposal.rolls, d.hideRolls);
    await tx.insert(schema.auditLog).values({
      gameId,
      roundId: round.id,
      actor: "dm",
      kind: "resolve.accept",
      description: `Accepted: ${d.text.slice(0, 200)}`,
      before: { orderId: order.id, previousStatus: "prepared", ...before },
      after: { changes },
    });
    return { ok: true as const };
  });
}

/** Marks an order as failed (its backup order, if any, becomes active), or skips it. */
export async function failOrder(gameId: string, orderId: string, text: string, status: "failed" | "skipped") {
  const { round, order } = await orderInRound(gameId, orderId);
  if (DONE.has(order.status)) throw new Error("That order has already been decided.");
  const previous = (order.outcome as OrderOutcome | null) ?? null;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.orders)
      .set({ status, outcome: { ...(previous ?? {}), text } })
      .where(eq(schema.orders.id, order.id));
    await tx.insert(schema.auditLog).values({
      gameId,
      roundId: round.id,
      actor: "dm",
      kind: `resolve.${status === "failed" ? "fail" : "skip"}`,
      description: `${status === "failed" ? "Failed" : "Skipped"}: ${text.slice(0, 200)}`,
      before: { orderId: order.id, previousStatus: order.status, units: [], regions: [], teams: [], inventory: [], createdUnitIds: [] },
    });
  });
}

/** Goes back from the end-of-round review to the queue (only before the end of round is applied). */
export async function backToQueue(gameId: string) {
  const { round } = await currentRound(gameId);
  const eor = round?.endOfRound as EndOfRoundState | null;
  if (!round || round.status !== "review" || eor?.applied) return;
  await db.update(schema.rounds).set({ status: "resolving" }).where(eq(schema.rounds.id, round.id));
}

/** Undoes the most recent resolution step in this round (accept, fail, skip or end of round). */
export async function undoLast(gameId: string): Promise<string | null> {
  const { round } = await currentRound(gameId);
  if (!round || (round.status !== "resolving" && round.status !== "review")) return null;
  return db.transaction(async (tx) => {
    await lockRound(tx, round.id);
    const [last] = await tx
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.roundId, round.id), eq(schema.auditLog.undone, false), like(schema.auditLog.kind, "resolve.%")))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1);
    if (!last) return null;
    const before = last.before as Before & { orderId?: string; previousStatus?: string };
    await restore(tx, gameId, before);
    if (before.orderId) {
      const [o] = await tx.select().from(schema.orders).where(eq(schema.orders.id, before.orderId));
      const outcome = o?.outcome as OrderOutcome | null;
      await tx
        .update(schema.orders)
        .set({ status: outcome?.proposal ? "prepared" : (before.previousStatus ?? "submitted") })
        .where(eq(schema.orders.id, before.orderId));
      await tx.delete(schema.rollLog).where(eq(schema.rollLog.orderId, before.orderId));
    }
    if (last.kind === "resolve.endOfRound") {
      const eor = round.endOfRound as EndOfRoundState | null;
      // Back to the queue; the DM works out the end of round again when ready.
      if (eor) await tx.update(schema.rounds).set({ status: "resolving", endOfRound: { ...eor, applied: false } }).where(eq(schema.rounds.id, round.id));
      // End-of-round rolls are the round's rolls that belong to no order.
      await tx.delete(schema.rollLog).where(and(eq(schema.rollLog.roundId, round.id), isNull(schema.rollLog.orderId)));
    }
    await tx.update(schema.auditLog).set({ undone: true }).where(eq(schema.auditLog.id, last.id));
    return last.description;
  });
}

// ——— End of round and publishing ———

/** Accepted trades waiting for the end of the round, oldest first. */
async function acceptedTrades(gameId: string, tx: Pick<typeof db, "select"> = db): Promise<TradeInput[]> {
  const rows = await tx
    .select()
    .from(schema.trades)
    .where(and(eq(schema.trades.gameId, gameId), eq(schema.trades.status, "accepted")))
    .orderBy(asc(schema.trades.respondedAt));
  return rows.map((t) => ({ id: t.id, fromTeamId: t.fromTeamId, toTeamId: t.toTeamId, give: t.give, get: t.get }));
}

/** Works out production, upkeep, per-round rolls, events, hazards, deficits and trades, for the DM to review. */
export async function computeEndOfRound(gameId: string, reroll = false, events?: { tableId: string; teamIds: string[] } | null) {
  const { round } = await currentRound(gameId);
  if (!round || (round.status !== "resolving" && round.status !== "review")) return;
  const previous = round.endOfRound as EndOfRoundState | null;
  if (previous?.applied) return;
  const [{ ruleset }, rows, trades] = await Promise.all([loadRuleset(gameId), loadGameRows(gameId), acceptedTrades(gameId)]);
  const n = reroll ? Number(previous?.seed.split(":").pop() ?? 0) + 1 : 0;
  const seed = `${round.id}:end:${n}`;
  const eventTable = ruleset.rollTables.find((t) => t.category === "event");
  const chosen =
    events !== undefined
      ? events
      : previous?.events !== undefined
        ? previous.events
        : ruleset.settings.roundEvents === "all" && eventTable
          ? { tableId: eventTable.id, teamIds: rows.teams.filter((t) => !t.isNpc).map((t) => t.id) }
          : null;
  const result = endOfRound(ruleset, rowsToWorld(rows), seed, { events: chosen, trades });
  const state: EndOfRoundState = { seed, result, adjust: previous?.adjust ?? {}, applied: false, events: chosen };
  await db.update(schema.rounds).set({ status: "review", endOfRound: state }).where(eq(schema.rounds.id, round.id));
}

export async function applyEndOfRound(gameId: string, adjust: Record<string, ResourceAmounts>) {
  const { round } = await currentRound(gameId);
  if (!round || round.status !== "review") throw new Error("Work out the end of round first.");
  const eor = round.endOfRound as EndOfRoundState | null;
  if (!eor || eor.applied) throw new Error("The end of round has already been applied.");
  await db.transaction(async (tx) => {
    await lockRound(tx, round.id);
    const changes: Change[] = [...eor.result.wild.changes];
    for (const t of eor.result.teams) {
      changes.push(...t.changes);
      const extra = adjust[t.teamId];
      if (extra && Object.values(extra).some((v) => v)) changes.push({ type: "resources", teamId: t.teamId, delta: extra });
    }
    // Trades go last. Only trades that are still accepted (not cancelled since) are applied.
    const tradeResults = eor.result.trades ?? [];
    const tradeRows = tradeResults.length
      ? await tx.select().from(schema.trades).where(and(eq(schema.trades.gameId, gameId), inArray(schema.trades.id, tradeResults.map((t) => t.tradeId))))
      : [];
    const live = tradeResults.filter((t) => tradeRows.find((x) => x.id === t.tradeId)?.status === "accepted");
    const maps: { fromTeamId: string; toTeamId: string }[] = [];
    for (const t of live.filter((x) => x.ok)) {
      for (const c of t.changes) {
        if (c.type === "shareMap") maps.push(c);
        else changes.push(c);
      }
    }
    const before = await captureBefore(tx, gameId, changes);
    before.trades = tradeRows.map((t) => ({ id: t.id, status: t.status, result: t.result, executedRound: t.executedRound }));
    before.knowledge = [];
    for (const toTeamId of [...new Set(maps.map((m) => m.toTeamId))]) {
      before.knowledge.push({
        teamId: toTeamId,
        regions: await tx.select().from(schema.teamRegionKnowledge).where(eq(schema.teamRegionKnowledge.teamId, toTeamId)),
        connections: await tx.select().from(schema.teamConnectionKnowledge).where(eq(schema.teamConnectionKnowledge.teamId, toTeamId)),
      });
    }
    const units = await tx
      .select({ id: schema.units.id, milesUsed: schema.units.milesUsed, usesSpent: schema.units.usesSpent })
      .from(schema.units)
      .where(eq(schema.units.gameId, gameId));
    before.resetUnits = units;
    await applyChanges(tx, gameId, changes);
    for (const m of maps) await shareMap(tx, gameId, m.fromTeamId, m.toTeamId, round.number);
    for (const t of live) {
      await tx
        .update(schema.trades)
        .set(t.ok ? { status: "executed", result: t.summary, executedRound: round.number } : { status: "failed", result: t.problems.join(" "), executedRound: round.number })
        .where(eq(schema.trades.id, t.tradeId));
    }
    // A new round: movement and per-round ability uses reset.
    await tx.update(schema.units).set({ milesUsed: 0, usesSpent: {} }).where(eq(schema.units.gameId, gameId));
    const rolls = [...eor.result.wild.rolls, ...eor.result.teams.flatMap((t) => t.rolls)];
    await logRolls(tx, gameId, round.id, null, rolls, false);
    await tx.update(schema.rounds).set({ endOfRound: { ...eor, adjust, applied: true } }).where(eq(schema.rounds.id, round.id));
    await tx.insert(schema.auditLog).values({
      gameId,
      roundId: round.id,
      actor: "dm",
      kind: "resolve.endOfRound",
      description: `Applied the end of round ${round.number}`,
      before,
      after: { changes },
    });
  });
}

/** Releases the results to the teams and keeps a snapshot of the game for history. */
export async function publishRound(gameId: string): Promise<number> {
  const { round } = await currentRound(gameId);
  if (!round || round.status !== "review") throw new Error("Finish resolving first.");
  const eor = round.endOfRound as EndOfRoundState | null;
  if (!eor?.applied) throw new Error("Apply the end of round first.");
  await db.transaction(async (tx) => {
    await lockRound(tx, round.id);
    const pending = await tx
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.roundId, round.id), inArray(schema.orders.status, [...PENDING])));
    for (const o of pending) {
      await tx.update(schema.orders).set({ status: "skipped" }).where(eq(schema.orders.id, o.id));
    }
    // Teams whose units saw each other this round have now met, and can trade.
    await recordMeetings(tx, gameId, round.number);
    const snapshot = await loadGameRows(gameId, tx);
    await tx.update(schema.rounds).set({ status: "published", publishedAt: new Date(), snapshot }).where(eq(schema.rounds.id, round.id));
    await tx.insert(schema.auditLog).values({ gameId, roundId: round.id, actor: "dm", kind: "round.publish", description: `Published round ${round.number}` });
  });
  return round.number;
}

export async function lastAuditEntry(gameId: string, roundId: string) {
  const [last] = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.gameId, gameId), eq(schema.auditLog.roundId, roundId), eq(schema.auditLog.undone, false), like(schema.auditLog.kind, "resolve.%")))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(1);
  return last ?? null;
}
