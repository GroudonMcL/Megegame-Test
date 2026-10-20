import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { cleanMessage, MAX_MESSAGE_LENGTH, unreadCount, type TeamNote } from "@/engine/messages";

// The conversation between the DM and each team. Players read and write only
// their own team's thread; the DM reads all of them. A DM change made while
// viewing as a team can send a note, which arrives here as a DM message.

type Tx = Pick<typeof db, "insert">;

/** How many messages a thread shows (the newest ones). */
const THREAD_LIMIT = 200;

/** The note that comes with a DM change, as it arrives from the browser. */
export const TeamNoteInput = z.object({ send: z.boolean(), text: z.string().max(MAX_MESSAGE_LENGTH * 2) }).optional();

export interface MessageView {
  id: string;
  fromDm: boolean;
  authorName: string;
  body: string;
  kind: string;
  createdAt: string;
}

/** Adds a message to a team's thread. Returns an error, or null when sent. */
export async function postMessage(
  tx: Tx,
  m: { gameId: string; teamId: string; fromDm: boolean; authorName: string; text: string; kind?: "message" | "note" },
): Promise<string | null> {
  const clean = cleanMessage(m.text);
  if (!clean) return "Write a message first.";
  if (!clean.ok) return clean.error;
  await tx.insert(schema.messages).values({ gameId: m.gameId, teamId: m.teamId, fromDm: m.fromDm, authorName: m.authorName.slice(0, 60), body: clean.body, kind: m.kind ?? "message" });
  return null;
}

/** Sends a DM change's note if the DM ticked the box (an empty note is skipped). */
export async function sendDmNote(tx: Tx, gameId: string, teamId: string, note: TeamNote | undefined) {
  if (!note?.send) return;
  const clean = cleanMessage(note.text.slice(0, MAX_MESSAGE_LENGTH));
  if (!clean?.ok) return;
  await tx.insert(schema.messages).values({ gameId, teamId, fromDm: true, authorName: "DM", body: clean.body, kind: "note" });
}

/** A team's thread, oldest first (the newest THREAD_LIMIT messages). */
export async function loadThread(gameId: string, teamId: string): Promise<MessageView[]> {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.gameId, gameId), eq(schema.messages.teamId, teamId)))
    .orderBy(desc(schema.messages.createdAt))
    .limit(THREAD_LIMIT);
  return rows.reverse().map((m) => ({ id: m.id, fromDm: m.fromDm, authorName: m.authorName, body: m.body, kind: m.kind, createdAt: m.createdAt.toISOString() }));
}

/**
 * Marks a thread read by the team (any player) or by the DM. Uses the
 * database's clock, like the messages' times. Call it before loading the
 * thread, so a message arriving in between still counts as unread.
 */
export async function markRead(gameId: string, teamId: string, reader: "dm" | "team") {
  const now = sql`now()`;
  await db
    .update(schema.teams)
    .set(reader === "dm" ? { dmReadAt: now } : { messagesReadAt: now })
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId)));
}

/** Messages in a team's thread the reader hasn't read: from the DM for the team, from the team for the DM. */
export async function threadUnread(team: { id: string; messagesReadAt: Date | null; dmReadAt: Date | null }, reader: "dm" | "team"): Promise<number> {
  const readAt = reader === "dm" ? team.dmReadAt : team.messagesReadAt;
  const rows = await db
    .select({ fromDm: schema.messages.fromDm, createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.teamId, team.id), eq(schema.messages.fromDm, reader === "team"), readAt ? gt(schema.messages.createdAt, readAt) : undefined));
  return unreadCount(rows, readAt, reader);
}

export interface InboxEntry {
  team: { id: string; name: string; colour: string; emblem: string; isNpc: boolean };
  unread: number;
  last: { authorName: string; body: string; createdAt: string } | null;
}

/** Every team in the game, with how many of its messages the DM hasn't read and its latest message. */
export async function dmInbox(gameId: string): Promise<InboxEntry[]> {
  const [teams, rows] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt)),
    db
      .select({ teamId: schema.messages.teamId, fromDm: schema.messages.fromDm, authorName: schema.messages.authorName, body: schema.messages.body, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(eq(schema.messages.gameId, gameId))
      .orderBy(asc(schema.messages.createdAt)),
  ]);
  return teams.map((t) => {
    const mine = rows.filter((m) => m.teamId === t.id);
    const last = mine.at(-1);
    return {
      team: { id: t.id, name: t.name, colour: t.colour, emblem: t.emblem, isNpc: t.isNpc },
      unread: unreadCount(mine, t.dmReadAt, "dm"),
      last: last ? { authorName: last.authorName, body: last.body, createdAt: last.createdAt.toISOString() } : null,
    };
  });
}

/** All unread player messages across the game, for the DM's dock badge. */
export async function dmUnreadTotal(gameId: string): Promise<number> {
  return (await dmInbox(gameId)).reduce((n, e) => n + e.unread, 0);
}
