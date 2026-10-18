import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getTeamSession, isDm } from "./session";

// Who is looking at the player screens: a player on their own team, or the DM
// using "view as team". Every player page and action goes through here.

const VIEW_AS = "mg_view_as";

export interface Viewer {
  gameId: string;
  teamId: string;
  team: typeof schema.teams.$inferSelect;
  game: typeof schema.games.$inferSelect;
  /** True when the DM is viewing as this team. */
  isDm: boolean;
  /** Written to the audit log and shown on orders: "dm" or "player:<name>". */
  actor: string;
  displayName: string;
}

export async function setViewAs(gameId: string, teamId: string) {
  (await cookies()).set(VIEW_AS, `${gameId}:${teamId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function clearViewAs() {
  (await cookies()).delete(VIEW_AS);
}

export async function getViewer(): Promise<Viewer | null> {
  if (await isDm()) {
    const raw = (await cookies()).get(VIEW_AS)?.value ?? "";
    const [gameId, teamId] = raw.split(":");
    if (!z.uuid().safeParse(gameId).success || !z.uuid().safeParse(teamId).success) return null;
    const [row] = await db
      .select({ team: schema.teams, game: schema.games })
      .from(schema.teams)
      .innerJoin(schema.games, eq(schema.teams.gameId, schema.games.id))
      .where(and(eq(schema.teams.id, teamId), eq(schema.games.id, gameId)))
      .limit(1);
    if (!row) return null;
    return { gameId, teamId, team: row.team, game: row.game, isDm: true, actor: "dm", displayName: "DM" };
  }
  const t = await getTeamSession();
  if (!t) return null;
  return {
    gameId: t.game.id,
    teamId: t.team.id,
    team: t.team,
    game: t.game,
    isDm: false,
    actor: `player:${t.player.displayName}`,
    displayName: t.player.displayName,
  };
}

/** For player pages: the viewer, or off to the join screen. */
export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (v) return v;
  if (await isDm()) redirect("/dm");
  redirect((await cookies()).has("mg_session") ? "/?expired=1" : "/");
}
