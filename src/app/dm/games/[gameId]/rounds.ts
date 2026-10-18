"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { requireDm } from "@/lib/session";
import { setViewAs } from "@/lib/viewer";

// Round controls for Phase 4: open the round, set its deadline, lock and
// reopen orders. Resolving and publishing come in Phase 5.

const Ids = z.object({ gameId: z.uuid() });
const Deadline = z.union([z.literal(""), z.iso.datetime({ offset: true })]);

async function currentRound(gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) throw new Error("Game not found");
  const [round] = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.currentRound)))
    .limit(1);
  return { game, round };
}

function done(gameId: string) {
  revalidatePath(`/dm/games/${gameId}`);
  revalidatePath("/play", "layout");
}

export async function openRoundAction(formData: FormData) {
  await requireDm();
  const { gameId } = Ids.parse({ gameId: formData.get("gameId") });
  const deadline = Deadline.parse(formData.get("deadline") ?? "");
  const { game, round } = await currentRound(gameId);
  // Opening the next round needs this one published (Phase 5).
  if (round && round.status !== "published") return;
  const number = game.currentRound + 1;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.rounds)
      .values({ gameId, number, status: "open", openedAt: new Date(), deadline: deadline ? new Date(deadline) : null })
      .returning();
    await tx.update(schema.games).set({ currentRound: number, status: "running" }).where(eq(schema.games.id, gameId));
    await audit(tx, { gameId, actor: "dm", kind: "round.open", description: `Opened round ${number}`, after: row });
  });
  done(gameId);
}

export async function setDeadlineAction(formData: FormData) {
  await requireDm();
  const { gameId } = Ids.parse({ gameId: formData.get("gameId") });
  const deadline = Deadline.parse(formData.get("deadline") ?? "");
  const { round } = await currentRound(gameId);
  if (!round) return;
  await db.update(schema.rounds).set({ deadline: deadline ? new Date(deadline) : null }).where(eq(schema.rounds.id, round.id));
  await audit(db, { gameId, actor: "dm", kind: "round.deadline", description: `Round ${round.number} deadline ${deadline ? `set to ${deadline}` : "removed"}` });
  done(gameId);
}

export async function lockRoundAction(formData: FormData) {
  await requireDm();
  const { gameId } = Ids.parse({ gameId: formData.get("gameId") });
  const { round } = await currentRound(gameId);
  if (!round || round.status !== "open") return;
  await db.update(schema.rounds).set({ status: "locked", lockedAt: new Date() }).where(eq(schema.rounds.id, round.id));
  await audit(db, { gameId, actor: "dm", kind: "round.lock", description: `Locked orders for round ${round.number}` });
  done(gameId);
}

export async function reopenRoundAction(formData: FormData) {
  await requireDm();
  const { gameId } = Ids.parse({ gameId: formData.get("gameId") });
  const { round } = await currentRound(gameId);
  if (!round || round.status !== "locked") return;
  await db.update(schema.rounds).set({ status: "open", lockedAt: null }).where(eq(schema.rounds.id, round.id));
  await audit(db, { gameId, actor: "dm", kind: "round.reopen", description: `Reopened orders for round ${round.number}` });
  done(gameId);
}

/** "View as team": the DM sees the player screens exactly as that team does. */
export async function viewAsTeamAction(formData: FormData) {
  await requireDm();
  const { gameId, teamId } = z.object({ gameId: z.uuid(), teamId: z.uuid() }).parse({ gameId: formData.get("gameId"), teamId: formData.get("teamId") });
  const [team] = await db.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId))).limit(1);
  if (!team) throw new Error("Team not found");
  await setViewAs(gameId, teamId);
  redirect("/play");
}
