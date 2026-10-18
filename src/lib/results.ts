import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LogEntry } from "@/engine/combat/types";
import type { ResourceAmounts } from "@/engine/ruleset/common";
import type { EndOfRoundState, OrderOutcome } from "./resolution";

// A team's published results. Only rounds the DM has published, and only
// this team's own orders and rolls (minus any the DM hid).

export interface TeamResults {
  number: number;
  publishedAt: Date | null;
  orders: {
    id: string;
    kind: string;
    slot: number | null;
    actionTypeId: string;
    status: string;
    notes: string;
    text: string;
    delta: ResourceAmounts | null;
    rolls: { label: string; breakdown: string }[];
    /** Round-by-round fight logs, if the DM shares them. */
    fights: LogEntry[][];
  }[];
  /** What happened to this team because of other teams' orders (e.g. being attacked). */
  reports: { text: string; fights: LogEntry[][] }[];
  endOfRound: { lines: string[]; change: ResourceAmounts; adjust: ResourceAmounts; rolls: { label: string; breakdown: string }[] } | null;
}

export async function loadTeamResults(gameId: string, teamId: string, opts: { limit?: number } = {}): Promise<TeamResults[]> {
  const rounds = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.status, "published")))
    .orderBy(desc(schema.rounds.number))
    .limit(opts.limit ?? 100);
  if (!rounds.length) return [];
  const roundIds = rounds.map((r) => r.id);
  const orders = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.roundId, roundIds), eq(schema.orders.teamId, teamId)))
    .orderBy(asc(schema.orders.position));
  const rolls = orders.length
    ? await db
        .select()
        .from(schema.rollLog)
        .where(and(inArray(schema.rollLog.orderId, orders.map((o) => o.id)), eq(schema.rollLog.hiddenFromPlayers, false)))
        .orderBy(asc(schema.rollLog.createdAt))
    : [];
  // Other teams' resolved orders that report something to this team.
  const others = await db
    .select({ roundId: schema.orders.roundId, outcome: schema.orders.outcome, position: schema.orders.position })
    .from(schema.orders)
    .where(and(inArray(schema.orders.roundId, roundIds), ne(schema.orders.teamId, teamId), eq(schema.orders.status, "resolved")))
    .orderBy(asc(schema.orders.position));
  const sharedFights = (out: Partial<OrderOutcome> | null) =>
    out?.combat?.shareLog === false || out?.combat?.byHand ? [] : (out?.proposal?.combats ?? []).filter((c) => c.endReason !== "noFight").map((c) => c.log);
  const breakdown = (r: typeof schema.rollLog.$inferSelect) => ({ label: r.label, breakdown: (r.result as { breakdown?: string })?.breakdown ?? String(r.total) });

  return rounds.map((round) => {
    const eor = round.endOfRound as EndOfRoundState | null;
    const mine = eor?.result.teams.find((t) => t.teamId === teamId);
    return {
      number: round.number,
      publishedAt: round.publishedAt,
      orders: orders
        .filter((o) => o.roundId === round.id)
        .map((o) => {
          const out = o.outcome as Partial<OrderOutcome> | null;
          return {
            id: o.id,
            kind: o.kind,
            slot: o.slot,
            actionTypeId: o.actionTypeId,
            status: o.status,
            notes: o.notes,
            text: out?.text || (o.status === "skipped" ? "Not carried out." : ""),
            delta: out?.delta ?? null,
            rolls: o.status === "resolved" ? rolls.filter((r) => r.orderId === o.id).map(breakdown) : [],
            fights: o.status === "resolved" ? sharedFights(out) : [],
          };
        }),
      reports: others
        .filter((o) => o.roundId === round.id)
        .flatMap((o) => {
          const out = o.outcome as Partial<OrderOutcome> | null;
          return (out?.proposal?.reports ?? []).filter((x) => x.teamId === teamId).map((x) => ({ text: x.text, fights: sharedFights(out) }));
        }),
      endOfRound: mine
        ? { lines: mine.lines, change: mine.economy.change, adjust: eor?.adjust[teamId] ?? {}, rolls: mine.rolls.map((r) => ({ label: r.label, breakdown: r.breakdown })) }
        : null,
    };
  });
}
