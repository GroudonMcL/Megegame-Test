import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { signSession, verifySession, type SessionPayload } from "./sessionToken";

const COOKIE = "mg_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  return process.env.SESSION_SECRET ?? "";
}

export async function setSession(payload: SessionPayload) {
  const token = await signSession(payload, secret(), MAX_AGE);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function readSession() {
  return verifySession((await cookies()).get(COOKIE)?.value, secret());
}

export async function isDm() {
  return (await readSession())?.role === "dm";
}

/** For DM pages and DM server actions. Sends anyone else to the DM login. */
export async function requireDm() {
  if (!(await isDm())) redirect("/dm/login");
}

/**
 * The signed-in player's team, re-checked against the database on every call so
 * that a deleted team, removed player or regenerated join code takes effect at once.
 */
export async function getTeamSession() {
  const s = await readSession();
  if (!s || s.role !== "team") return null;
  const rows = await db
    .select({ team: schema.teams, player: schema.players, game: schema.games })
    .from(schema.players)
    .innerJoin(schema.teams, eq(schema.players.teamId, schema.teams.id))
    .innerJoin(schema.games, eq(schema.teams.gameId, schema.games.id))
    .where(and(eq(schema.players.id, s.playerId), eq(schema.teams.id, s.teamId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.team.sessionEpoch !== s.epoch) return null;
  return row;
}

export async function requireTeam() {
  const t = await getTeamSession();
  if (!t) redirect((await cookies()).has(COOKIE) ? "/?expired=1" : "/");
  return t;
}
