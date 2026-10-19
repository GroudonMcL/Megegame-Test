import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { fmtRes } from "@/engine/ruleset/effects";
import { audit } from "./audit";
import type { EndOfRoundState } from "./resolution";
import { loadRuleset } from "./rulesets";

// Notifications to Discord through webhooks: the game's public channel (round
// opened, reminders, published) and each team's private channel ("your results
// are ready"). Webhook URLs are secrets, so only the DM ever sees them. A
// failed post never stops the game; it's noted in the audit log.

const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export function validWebhook(url: string): boolean {
  return url === "" || WEBHOOK.test(url) || (process.env.NODE_ENV !== "production" && url.startsWith("http://localhost:"));
}

/** The app's address, for links in messages. */
export async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  } catch {
    // Not in a request (e.g. a scheduled job).
  }
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
}

export async function postDiscord(url: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!url) return { ok: false, error: "No webhook set." };
  if (!validWebhook(url)) return { ok: false, error: "That isn't a Discord webhook URL." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No @everyone or role pings from game text.
      body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Discord answered ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Discord." };
  }
}

async function post(gameId: string, url: string, content: string, what: string) {
  if (!url) return;
  const r = await postDiscord(url, content);
  if (!r.ok) await audit(db, { gameId, actor: "system", kind: "discord.fail", description: `Discord (${what}): ${r.error}` });
}

function when(d: Date | null) {
  return d ? `<t:${Math.floor(d.getTime() / 1000)}:F> (<t:${Math.floor(d.getTime() / 1000)}:R>)` : "no deadline set";
}

async function gameAndRound(gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) return null;
  const [round] = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.currentRound)))
    .limit(1);
  return { game, round: round ?? null };
}

export async function notifyRoundOpened(gameId: string, origin: string) {
  const g = await gameAndRound(gameId);
  if (!g?.round || !g.game.discordWebhookUrl) return;
  await post(gameId, g.game.discordWebhookUrl, `📜 **${g.game.name}: round ${g.round.number} is open.** Orders are due ${when(g.round.deadline)}.${origin ? `\n${origin}/play/orders` : ""}`, "round opened");
}

/** A reminder in the public channel naming the teams that haven't submitted yet. */
export async function notifyReminder(gameId: string, origin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gameAndRound(gameId);
  if (!g?.round) return { ok: false, error: "No round is open." };
  if (!g.game.discordWebhookUrl) return { ok: false, error: "Set the game's Discord webhook on the Settings page first." };
  const [teams, states] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt)),
    db.select().from(schema.teamRoundOrders).where(eq(schema.teamRoundOrders.roundId, g.round.id)),
  ]);
  const waiting = teams.filter((t) => !t.isNpc && !states.find((s) => s.teamId === t.id)?.submittedAt).map((t) => t.name);
  const text = `⏰ **Reminder: round ${g.round.number} orders are due ${when(g.round.deadline)}.** ${waiting.length ? `Still to submit: ${waiting.join(", ")}.` : "Every team has submitted."}${origin ? `\n${origin}/play/orders` : ""}`;
  const r = await postDiscord(g.game.discordWebhookUrl, text);
  if (!r.ok) await audit(db, { gameId, actor: "system", kind: "discord.fail", description: `Discord (reminder): ${r.error}` });
  return r;
}

/** Public "round published", and each team's own "your results are ready" with its resource changes. */
export async function notifyPublished(gameId: string, roundNumber: number, origin: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) return;
  const [round] = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, roundNumber)))
    .limit(1);
  if (!round) return;
  await post(gameId, game.discordWebhookUrl, `📯 **${game.name}: round ${roundNumber} has been resolved.** Check your results in the app.`, "published");
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId));
  const { ruleset } = await loadRuleset(gameId);
  const eor = round.endOfRound as EndOfRoundState | null;
  for (const t of teams) {
    if (!t.discordWebhookUrl) continue;
    const mine = eor?.result.teams.find((x) => x.teamId === t.id);
    const orders = await db
      .select({ outcome: schema.orders.outcome, status: schema.orders.status })
      .from(schema.orders)
      .where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, t.id)));
    const change: Record<string, number> = { ...(mine?.economy.change ?? {}) };
    for (const o of orders) for (const [k, v] of Object.entries((o.outcome as { delta?: Record<string, number> } | null)?.delta ?? {})) change[k] = (change[k] ?? 0) + v;
    for (const [k, v] of Object.entries(eor?.adjust[t.id] ?? {})) change[k] = (change[k] ?? 0) + v;
    const signed = Object.entries(change)
      .filter(([, v]) => v)
      .map(([k, v]) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} ${ruleset.resources.find((x) => x.id === k)?.name ?? k}`)
      .join(", ");
    const done = orders.filter((o) => o.status === "resolved").length;
    await post(
      gameId,
      t.discordWebhookUrl,
      `📬 **${t.name}: your round ${roundNumber} results are ready.** ${done} order${done === 1 ? "" : "s"} carried out. Resources: ${signed || "no change"}; now ${fmtRes(t.resources, ruleset.resources)}.${origin ? `\n${origin}/play/results` : ""}`,
      `results for ${t.name}`,
    );
  }
}

/** For the scheduled job: rounds whose deadline is within a day and haven't had a reminder yet. */
export async function sendDueReminders(origin: string): Promise<number> {
  const open = await db.select().from(schema.rounds).where(eq(schema.rounds.status, "open"));
  const soon = open.filter((r) => r.deadline && !r.reminderSentAt && r.deadline.getTime() - Date.now() <= 24 * 3600 * 1000 && r.deadline.getTime() > Date.now());
  let sent = 0;
  for (const r of soon) {
    const res = await notifyReminder(r.gameId, origin);
    await db.update(schema.rounds).set({ reminderSentAt: new Date() }).where(eq(schema.rounds.id, r.id));
    if (res.ok) sent++;
  }
  return sent;
}
