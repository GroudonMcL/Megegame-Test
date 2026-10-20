"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TeamNoteInput } from "@/lib/messages";
import { Bundle, cancelTrade, proposeTrade, respondToTrade, type ByDm } from "@/lib/trades";
import { getViewer } from "@/lib/viewer";

// Trade actions for the signed-in team (or the DM viewing as it, whose steps
// are logged as DM changes and can send a note to the team).

type Result = { ok: true } | { ok: false; error: string };

const Propose = z.object({ toTeamId: z.uuid(), give: Bundle, get: Bundle, message: z.string().max(2000), note: TeamNoteInput });

async function asTeam(note: unknown, fn: (gameId: string, teamId: string, dm: ByDm | undefined) => Promise<string | null>): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended. Join again with your team code." };
  const parsedNote = TeamNoteInput.safeParse(note);
  const error = await fn(viewer.gameId, viewer.teamId, viewer.isDm ? { note: parsedNote.success ? parsedNote.data : undefined } : undefined);
  revalidatePath("/play", "layout");
  return error ? { ok: false, error } : { ok: true };
}

export async function proposeTradeAction(input: z.input<typeof Propose>): Promise<Result> {
  const parsed = Propose.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That trade couldn't be read." };
  const { toTeamId, give, get, message, note } = parsed.data;
  return asTeam(note, (gameId, teamId, dm) => proposeTrade(gameId, teamId, toTeamId, give, get, message, dm));
}

export async function respondTradeAction(tradeId: string, accept: boolean, note?: unknown): Promise<Result> {
  const id = z.uuid().safeParse(tradeId);
  if (!id.success) return { ok: false, error: "Trade not found." };
  return asTeam(note, (gameId, teamId, dm) => respondToTrade(gameId, teamId, id.data, Boolean(accept), dm));
}

export async function cancelTradeAction(tradeId: string, note?: unknown): Promise<Result> {
  const id = z.uuid().safeParse(tradeId);
  if (!id.success) return { ok: false, error: "Trade not found." };
  return asTeam(note, (gameId, teamId, dm) => cancelTrade(gameId, teamId, id.data, dm));
}
