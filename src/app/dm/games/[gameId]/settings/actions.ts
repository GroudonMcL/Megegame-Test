"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { postDiscord, validWebhook } from "@/lib/discord";
import { requireDm } from "@/lib/session";

// Discord webhooks for the game's public channel and each team's channel.

type State = { ok: boolean; message: string } | null;
const Url = z.string().trim().max(500);

export async function saveWebhooksAction(_prev: State, formData: FormData): Promise<State> {
  await requireDm();
  const gameId = z.uuid().parse(formData.get("gameId"));
  const game = Url.parse(formData.get("game") ?? "");
  if (!validWebhook(game)) return { ok: false, message: "The game's webhook doesn't look like a Discord webhook URL." };
  const teams = await db.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams).where(eq(schema.teams.gameId, gameId));
  const teamUrls: { id: string; url: string }[] = [];
  for (const t of teams) {
    const url = Url.parse(formData.get(`team-${t.id}`) ?? "");
    if (!validWebhook(url)) return { ok: false, message: `${t.name}'s webhook doesn't look like a Discord webhook URL.` };
    teamUrls.push({ id: t.id, url });
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.games).set({ discordWebhookUrl: game }).where(eq(schema.games.id, gameId));
    for (const t of teamUrls) await tx.update(schema.teams).set({ discordWebhookUrl: t.url }).where(and(eq(schema.teams.id, t.id), eq(schema.teams.gameId, gameId)));
    await audit(tx, { gameId, actor: "dm", kind: "discord.webhooks", description: "Changed the Discord webhooks" });
  });
  revalidatePath(`/dm/games/${gameId}/settings`);
  return { ok: true, message: "Saved." };
}

/** Sends a test message to the game's channel (and every team channel that's set). */
export async function testWebhooksAction(_prev: State, formData: FormData): Promise<State> {
  await requireDm();
  const gameId = z.uuid().parse(formData.get("gameId"));
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) return { ok: false, message: "Game not found." };
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId));
  const targets = [{ name: "the game channel", url: game.discordWebhookUrl }, ...teams.map((t) => ({ name: t.name, url: t.discordWebhookUrl }))].filter((x) => x.url);
  if (!targets.length) return { ok: false, message: "No webhooks are saved yet." };
  const failed: string[] = [];
  for (const t of targets) {
    const r = await postDiscord(t.url, `✅ Test message from ${game.name}: this channel (${t.name}) will get the game's notifications.`);
    if (!r.ok) failed.push(`${t.name}: ${r.error}`);
  }
  return failed.length ? { ok: false, message: `Some failed. ${failed.join(" ")}` } : { ok: true, message: `Test sent to ${targets.length} channel${targets.length === 1 ? "" : "s"}.` };
}
