"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Bundle, cancelTrade, proposeTrade, respondToTrade } from "@/lib/trades";
import { getViewer } from "@/lib/viewer";

// Trade actions for the signed-in team (or the DM viewing as it).

type Result = { ok: true } | { ok: false; error: string };

const Propose = z.object({ toTeamId: z.uuid(), give: Bundle, get: Bundle, message: z.string().max(2000) });

async function asTeam(fn: (gameId: string, teamId: string) => Promise<string | null>): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended. Join again with your team code." };
  const error = await fn(viewer.gameId, viewer.teamId);
  revalidatePath("/play/trades");
  return error ? { ok: false, error } : { ok: true };
}

export async function proposeTradeAction(input: z.input<typeof Propose>): Promise<Result> {
  const parsed = Propose.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That trade couldn't be read." };
  const { toTeamId, give, get, message } = parsed.data;
  return asTeam((gameId, teamId) => proposeTrade(gameId, teamId, toTeamId, give, get, message));
}

export async function respondTradeAction(tradeId: string, accept: boolean): Promise<Result> {
  const id = z.uuid().safeParse(tradeId);
  if (!id.success) return { ok: false, error: "Trade not found." };
  return asTeam((gameId, teamId) => respondToTrade(gameId, teamId, id.data, Boolean(accept)));
}

export async function cancelTradeAction(tradeId: string): Promise<Result> {
  const id = z.uuid().safeParse(tradeId);
  if (!id.success) return { ok: false, error: "Trade not found." };
  return asTeam((gameId, teamId) => cancelTrade(gameId, teamId, id.data));
}
