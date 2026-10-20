"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { markRead, postMessage } from "@/lib/messages";
import { requireDm } from "@/lib/session";

// The DM writes to one team from the Messages window.

export async function dmSendMessageAction(gameId: string, teamId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireDm();
  const ids = z.object({ gameId: z.uuid(), teamId: z.uuid() }).safeParse({ gameId, teamId });
  if (!ids.success || typeof text !== "string") return { ok: false, error: "Team not found." };
  const [team] = await db.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId))).limit(1);
  if (!team) return { ok: false, error: "Team not found." };
  const error = await postMessage(db, { gameId, teamId, fromDm: true, authorName: "DM", text });
  if (error) return { ok: false, error };
  await markRead(gameId, teamId, "dm");
  revalidatePath(`/dm/games/${gameId}`, "layout");
  revalidatePath("/play", "layout");
  return { ok: true };
}
