import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { dmMoveOrder, dmMoveRecord, normalMoveFor, type UnitSpot } from "@/engine/dmMoves";
import type { Pt } from "@/engine/geo/polygon";
import type { TeamNote } from "@/engine/messages";
import { validateOrders, type OrderDraft } from "@/engine/orders/validate";
import { audit } from "./audit";
import { ordersStateFor, revertUnitMove, undoDmChange, type OrdersState } from "./dmEdits";
import { sendDmNote } from "./messages";
import { loadRuleset } from "./rulesets";
import { loadTeamView } from "./teamView";

// The DM dragging units on the World map (the plans are in src/engine/dmMoves.ts).
// An instant move puts the units straight there: no miles used, no fight, no
// border or distance checks. It's logged as "dm.move" per team (wild monsters:
// no team) and can be undone. The other choice adds a move order to the team's
// orders for this round ("dm.orders", undoable like any DM change to orders),
// which is resolved like the team's own moves except that it ignores borders
// (it still only goes as far as the units' miles allow).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MoveTarget {
  regionId: string;
  at: Pt;
}

/** One logged change, for the Undo on the World map. */
export interface DoneChange {
  auditId: string;
  teamId: string | null;
}

async function regionInGame(tx: Tx, gameId: string, regionId: string) {
  const [r] = await tx.select({ code: schema.regions.code }).from(schema.regions).where(and(eq(schema.regions.id, regionId), eq(schema.regions.gameId, gameId)));
  return r ?? null;
}

const teamNames = async (tx: Tx, gameId: string) => new Map((await tx.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams).where(eq(schema.teams.gameId, gameId))).map((t) => [t.id, t.name]));

/**
 * Moves the units there now. notes: a note per team (wild monsters get none).
 * Returns the logged changes (one per owner), or an error.
 */
export async function dmMoveNow(gameId: string, unitIds: string[], to: MoveTarget, notes: Record<string, TeamNote | undefined>): Promise<{ error: string } | { done: DoneChange[] }> {
  return db.transaction(async (tx) => {
    const region = await regionInGame(tx, gameId, to.regionId);
    if (!region) return { error: "That region isn't in this game." };
    const units = await tx
      .select()
      .from(schema.units)
      .where(and(eq(schema.units.gameId, gameId), inArray(schema.units.id, unitIds)))
      .for("update");
    if (units.length !== unitIds.length) return { error: "Some of those units no longer exist." };
    const names = await teamNames(tx, gameId);
    const done: DoneChange[] = [];
    for (const owner of [...new Set(units.map((u) => u.ownerTeamId))]) {
      const mine = units.filter((u) => u.ownerTeamId === owner);
      const record = dmMoveRecord(
        mine.map((u) => ({ unitId: u.id, regionId: u.regionId, x: u.x, y: u.y })),
        to,
      );
      await tx
        .update(schema.units)
        .set({ regionId: to.regionId, x: to.at[0], y: to.at[1] })
        .where(and(eq(schema.units.gameId, gameId), inArray(schema.units.id, mine.map((u) => u.id))));
      const who = mine.length === 1 ? mine[0].name || "a unit" : `${mine.length} units`;
      const description = `Moved ${who} ${owner ? `of ${names.get(owner) ?? "a team"}` : "(wild)"} to ${region.code} (instant change)`;
      const [row] = await tx
        .insert(schema.auditLog)
        .values({ gameId, actor: "dm", kind: "dm.move", teamId: owner, description, before: record.before, after: record.after })
        .returning({ id: schema.auditLog.id });
      done.push({ auditId: row.id, teamId: owner });
      if (owner) await sendDmNote(tx, gameId, owner, notes[owner]);
    }
    return { done };
  });
}

/**
 * Adds a move straight to the point to each team's orders for this round, at
 * the end of its list. groups: each team's units. Returns the logged changes,
 * or an error (and then nothing is added).
 */
export async function dmAddMoveOrders(gameId: string, groups: { teamId: string; unitIds: string[] }[], to: MoveTarget, notes: Record<string, TeamNote | undefined>): Promise<{ error: string } | { done: DoneChange[] }> {
  const { ruleset } = await loadRuleset(gameId);
  // Checked against each team's own view, like the team's own saves (to mark the order if it fails them).
  const views = await Promise.all(groups.map((g) => loadTeamView(gameId, g.teamId, { record: false })));
  return db.transaction(async (tx) => {
    const region = await regionInGame(tx, gameId, to.regionId);
    if (!region) return { error: "That region isn't in this game." };
    const [game] = await tx.select({ round: schema.games.currentRound }).from(schema.games).where(eq(schema.games.id, gameId));
    const [round] = game
      ? await tx
          .select()
          .from(schema.rounds)
          .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.round)))
          .for("update")
      : [];
    if (!round || (round.status !== "open" && round.status !== "locked")) return { error: "Move orders can only be added while a round is open or locked. Use an instant change instead." };
    const names = await teamNames(tx, gameId);
    const done: DoneChange[] = [];
    for (const [i, g] of groups.entries()) {
      const units = await tx
        .select()
        .from(schema.units)
        .where(and(eq(schema.units.gameId, gameId), eq(schema.units.ownerTeamId, g.teamId), inArray(schema.units.id, g.unitIds)));
      if (units.length !== g.unitIds.length) return { error: "Some of those units no longer belong to that team." };
      const action = normalMoveFor(ruleset, units);
      if (!action) return { error: `There's no move that all of ${names.get(g.teamId) ?? "that team"}'s units here can take.` };

      await tx.insert(schema.teamRoundOrders).values({ roundId: round.id, teamId: g.teamId }).onConflictDoNothing();
      const [state] = await tx
        .select()
        .from(schema.teamRoundOrders)
        .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, g.teamId)))
        .for("update");
      const before = await ordersStateFor(tx, round.id, g.teamId, state.version, state);
      const rows = await tx
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, g.teamId)))
        .orderBy(asc(schema.orders.position));
      const existing: OrderDraft[] = rows.map((o) => ({ id: o.id, kind: o.kind as OrderDraft["kind"], actionTypeId: o.actionTypeId, inputs: o.inputs, notes: o.notes }));
      const order = dmMoveOrder(action, g.unitIds, to.at, crypto.randomUUID());
      const check = validateOrders(views[i].rules, views[i].view, [...existing, order]).orders.at(-1)!;
      await tx.insert(schema.orders).values({
        id: order.id,
        roundId: round.id,
        teamId: g.teamId,
        position: rows.length ? Math.max(...rows.map((o) => o.position)) + 1 : 0,
        kind: "free",
        slot: null,
        parentOrderId: null,
        actionTypeId: order.actionTypeId,
        inputs: order.inputs,
        notes: order.notes,
        // Submitted orders stay submitted: the DM's move is part of them.
        status: state.submittedAt ? "submitted" : "draft",
        bypassed: check.problems.length > 0,
        updatedAt: new Date(),
      });
      const version = state.version + 1;
      await tx
        .update(schema.teamRoundOrders)
        .set({ version, updatedAt: new Date(), updatedBy: "DM" })
        .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, g.teamId)));
      const after: OrdersState = { roundId: round.id, version, submittedAt: state.submittedAt?.toISOString() ?? null, submittedBy: state.submittedBy };
      const who = units.length === 1 ? units[0].name || "a unit" : `${units.length} units`;
      const description = `Added a move for ${names.get(g.teamId) ?? "a team"}: ${who} to ${region.code}${check.problems.length ? " (checks bypassed)" : ""}`;
      const [row] = await tx
        .insert(schema.auditLog)
        .values({ gameId, actor: "dm", kind: "dm.orders", teamId: g.teamId, description, before, after })
        .returning({ id: schema.auditLog.id });
      done.push({ auditId: row.id, teamId: g.teamId });
      await sendDmNote(tx, gameId, g.teamId, notes[g.teamId]);
    }
    return { done };
  });
}

/** Undoes a change made from the World map: a team's through its DM log, a wild move here. */
export async function undoWorldChange(gameId: string, auditId: string): Promise<string | null> {
  const [entry] = await db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.id, auditId), eq(schema.auditLog.gameId, gameId)));
  if (!entry || (entry.kind !== "dm.move" && entry.kind !== "dm.orders")) return "That change wasn't found.";
  if (entry.teamId) return undoDmChange(gameId, entry.teamId, auditId);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.id, auditId)).for("update");
    if (row.undone) return "That change has already been undone.";
    const problem = await revertUnitMove(tx, gameId, row.before as UnitSpot[], row.after as UnitSpot[]);
    if (problem) return problem;
    await tx.update(schema.auditLog).set({ undone: true }).where(eq(schema.auditLog.id, row.id));
    await audit(tx, { gameId, actor: "dm", kind: "undo", description: `Undid: ${row.description}`, before: { auditId: row.id } });
    return null;
  });
}
