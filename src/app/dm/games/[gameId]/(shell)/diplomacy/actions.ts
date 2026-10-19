"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { setContact } from "@/lib/contacts";
import { requireDm } from "@/lib/session";
import { cancelTrade } from "@/lib/trades";

// The DM marks which teams have met, and can call off any trade.

export async function setContactAction(formData: FormData) {
  await requireDm();
  const { gameId, a, b, met } = z
    .object({ gameId: z.uuid(), a: z.uuid(), b: z.uuid(), met: z.enum(["1", "0"]) })
    .parse({ gameId: formData.get("gameId"), a: formData.get("a"), b: formData.get("b"), met: formData.get("met") });
  const [game] = await db.select({ currentRound: schema.games.currentRound }).from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  await setContact(gameId, a, b, met === "1", game?.currentRound ?? 0);
  await audit(db, { gameId, actor: "dm", kind: "contact.set", description: met === "1" ? "Marked two teams as having met" : "Removed contact between two teams" });
  revalidatePath(`/dm/games/${gameId}/diplomacy`);
  revalidatePath("/play", "layout");
}

export async function dmCancelTradeAction(formData: FormData) {
  await requireDm();
  const { gameId, tradeId } = z.object({ gameId: z.uuid(), tradeId: z.uuid() }).parse({ gameId: formData.get("gameId"), tradeId: formData.get("tradeId") });
  await cancelTrade(gameId, "dm", tradeId);
  revalidatePath(`/dm/games/${gameId}/diplomacy`);
  revalidatePath("/play", "layout");
}
