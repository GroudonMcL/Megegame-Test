import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { lendProblem } from "@/engine/lending";
import type { TeamNote } from "@/engine/messages";
import { audit } from "./audit";
import { contactsOf } from "./contacts";
import { sendDmNote } from "./messages";
import { FROZEN_STATUSES } from "./teamView";

// A team lending one of its units to another team (or taking it back). The
// rules are in src/engine/lending.ts. Logged as "unit.lend"; when the DM does
// it while viewing as the team, as "dm.lend" (undoable from the team's DM log).

/** dm.lend: who the unit was lent to (null = nobody). */
export interface LendState {
  unitId: string;
  lentToTeamId: string | null;
}

/** Lends the team's unit to toTeamId, or takes it back (null). Returns an error, or null when done. */
export async function lendUnit(
  gameId: string,
  teamId: string,
  unitId: string,
  toTeamId: string | null,
  by: { isDm: boolean; displayName: string; note?: TeamNote },
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select({ round: schema.games.currentRound }).from(schema.games).where(eq(schema.games.id, gameId));
    const [round] = game ? await tx.select({ status: schema.rounds.status }).from(schema.rounds).where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.round))) : [];
    const [unit] = await tx
      .select()
      .from(schema.units)
      .where(and(eq(schema.units.id, unitId), eq(schema.units.gameId, gameId)))
      .for("update");
    const contacts = await contactsOf(gameId, teamId, tx);
    const problem = lendProblem(unit, teamId, toTeamId, contacts, Boolean(round && FROZEN_STATUSES.has(round.status)));
    if (problem) return problem;
    await tx.update(schema.units).set({ lentToTeamId: toTeamId }).where(eq(schema.units.id, unitId));
    const teams = await tx.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams).where(eq(schema.teams.gameId, gameId));
    const name = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "another faction";
    const unitName = unit.name || "a unit";
    const description = toTeamId ? `${name(teamId)} lent ${unitName} to ${name(toTeamId)}` : `${name(teamId)} took back ${unitName} from ${name(unit.lentToTeamId)}`;
    const before: LendState = { unitId, lentToTeamId: unit.lentToTeamId };
    const after: LendState = { unitId, lentToTeamId: toTeamId };
    await audit(tx, { gameId, actor: by.isDm ? "dm" : by.displayName, kind: by.isDm ? "dm.lend" : "unit.lend", teamId, description, before, after });
    if (by.isDm) await sendDmNote(tx, gameId, teamId, by.note);
    return null;
  });
}
