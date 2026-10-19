import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { ACTIVE_STATUSES } from "@/engine/world/types";

// Which teams have met, and so may trade. Stored once per pair (teamA < teamB).
// Teams meet when their units share a region and at least one side can see the
// other's (out in the open, or spotted); the DM can also mark contact by hand.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = Pick<typeof db, "select" | "insert" | "delete">;

const pair = (a: string, b: string) => (a < b ? { teamA: a, teamB: b } : { teamA: b, teamB: a });

export async function contactsOf(gameId: string, teamId: string, tx: Pick<typeof db, "select"> = db): Promise<string[]> {
  const teams = await tx.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.gameId, gameId));
  if (!teams.some((t) => t.id === teamId)) return [];
  const rows = await tx
    .select()
    .from(schema.teamContacts)
    .where(or(eq(schema.teamContacts.teamA, teamId), eq(schema.teamContacts.teamB, teamId)));
  return rows.map((r) => (r.teamA === teamId ? r.teamB : r.teamA));
}

export async function allContacts(gameId: string) {
  const teams = await db.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.gameId, gameId));
  if (!teams.length) return [];
  return db.select().from(schema.teamContacts).where(inArray(schema.teamContacts.teamA, teams.map((t) => t.id)));
}

export async function setContact(gameId: string, a: string, b: string, met: boolean, round: number, tx: Db = db) {
  if (a === b) return;
  const teams = await tx.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.gameId, gameId), inArray(schema.teams.id, [a, b])));
  if (teams.length !== 2) throw new Error("Both teams must be in this game.");
  const p = pair(a, b);
  if (met) await tx.insert(schema.teamContacts).values({ ...p, since: round }).onConflictDoNothing();
  else await tx.delete(schema.teamContacts).where(and(eq(schema.teamContacts.teamA, p.teamA), eq(schema.teamContacts.teamB, p.teamB)));
}

/** Adds contact between teams whose units can see each other in the same region. Returns the new pairs. */
export async function recordMeetings(tx: Tx, gameId: string, round: number): Promise<{ teamA: string; teamB: string }[]> {
  const [units, teams] = await Promise.all([
    tx.select().from(schema.units).where(eq(schema.units.gameId, gameId)),
    tx.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.gameId, gameId)),
  ]);
  const teamIds = teams.map((t) => t.id);
  const detections = teamIds.length ? await tx.select().from(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.teamId, teamIds)) : [];
  const existing = teamIds.length ? await tx.select().from(schema.teamContacts).where(inArray(schema.teamContacts.teamA, teamIds)) : [];
  const seen = (viewer: string, u: (typeof units)[number]) => u.status === "active" || detections.some((d) => d.teamId === viewer && d.unitId === u.id);
  const found = new Map<string, { teamA: string; teamB: string }>();
  const byRegion = new Map<string, typeof units>();
  for (const u of units) {
    if (!u.regionId || !u.ownerTeamId || !ACTIVE_STATUSES.has(u.status)) continue;
    byRegion.set(u.regionId, [...(byRegion.get(u.regionId) ?? []), u]);
  }
  for (const list of byRegion.values()) {
    for (const a of list) {
      for (const b of list) {
        if (a.ownerTeamId === b.ownerTeamId) continue;
        if (!seen(a.ownerTeamId!, b) && !seen(b.ownerTeamId!, a)) continue;
        const p = pair(a.ownerTeamId!, b.ownerTeamId!);
        if (!existing.some((e) => e.teamA === p.teamA && e.teamB === p.teamB)) found.set(`${p.teamA}:${p.teamB}`, p);
      }
    }
  }
  const pairs = [...found.values()];
  if (pairs.length) await tx.insert(schema.teamContacts).values(pairs.map((p) => ({ ...p, since: round }))).onConflictDoNothing();
  return pairs;
}
