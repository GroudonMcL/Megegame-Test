// Messages between the DM and one team: cleaning what's typed and counting
// what hasn't been read yet. No database code here; src/lib/messages.ts uses it.

export const MAX_MESSAGE_LENGTH = 2000;

/** Trims a message, drops runs of blank lines and checks its length. Null = nothing to send. */
export function cleanMessage(text: string): { ok: true; body: string } | { ok: false; error: string } | null {
  const body = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return null;
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.` };
  return { ok: true, body };
}

export interface MessageStamp {
  fromDm: boolean;
  createdAt: Date;
}

/**
 * How many messages the reader hasn't seen: those from the other side sent
 * after the reader last opened the conversation (never opened = all of them).
 */
export function unreadCount(messages: MessageStamp[], readAt: Date | null, reader: "dm" | "team"): number {
  const fromOther = reader === "dm" ? (m: MessageStamp) => !m.fromDm : (m: MessageStamp) => m.fromDm;
  return messages.filter((m) => fromOther(m) && (!readAt || m.createdAt > readAt)).length;
}

/** The optional "Send a note to the team" that comes with a DM change. */
export interface TeamNote {
  send: boolean;
  text: string;
}
