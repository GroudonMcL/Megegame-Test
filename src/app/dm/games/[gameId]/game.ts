import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

/** The game row for a DM page (once per request), or a 404. */
export const loadGame = cache(async (gameId: string) => {
  if (!z.uuid().safeParse(gameId).success) notFound();
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) notFound();
  return game;
});
