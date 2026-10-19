import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadRuleset } from "./rulesets";

// Downloads for the DM: the whole game as one JSON backup, and CSV sheets of
// the main tables for spreadsheets.

export const EXPORT_FORMAT = 1;

/** Everything stored for one game. Uploaded files are included as base64. */
export async function exportGame(gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) return null;
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt));
  const teamIds = teams.map((t) => t.id);
  const inTeams = async <T>(q: (ids: string[]) => Promise<T[]>) => (teamIds.length ? q(teamIds) : []);
  const rounds = await db.select().from(schema.rounds).where(eq(schema.rounds.gameId, gameId)).orderBy(asc(schema.rounds.number));
  const roundIds = rounds.map((r) => r.id);
  const [ruleset, assets, players, regions, connections, units, inventory, regionKnowledge, connectionKnowledge, detections, contacts, trades, orders, roundOrders, rolls, audit] = await Promise.all([
    db.select().from(schema.gameRulesets).where(eq(schema.gameRulesets.gameId, gameId)),
    db.select().from(schema.assets).where(eq(schema.assets.gameId, gameId)),
    inTeams((ids) => db.select().from(schema.players).where(inArray(schema.players.teamId, ids))),
    db.select().from(schema.regions).where(eq(schema.regions.gameId, gameId)),
    db.select().from(schema.connections).where(eq(schema.connections.gameId, gameId)),
    db.select().from(schema.units).where(eq(schema.units.gameId, gameId)),
    inTeams((ids) => db.select().from(schema.inventory).where(inArray(schema.inventory.teamId, ids))),
    inTeams((ids) => db.select().from(schema.teamRegionKnowledge).where(inArray(schema.teamRegionKnowledge.teamId, ids))),
    inTeams((ids) => db.select().from(schema.teamConnectionKnowledge).where(inArray(schema.teamConnectionKnowledge.teamId, ids))),
    inTeams((ids) => db.select().from(schema.teamUnitDetections).where(inArray(schema.teamUnitDetections.teamId, ids))),
    inTeams((ids) => db.select().from(schema.teamContacts).where(inArray(schema.teamContacts.teamA, ids))),
    db.select().from(schema.trades).where(eq(schema.trades.gameId, gameId)),
    roundIds.length ? db.select().from(schema.orders).where(inArray(schema.orders.roundId, roundIds)) : [],
    roundIds.length ? db.select().from(schema.teamRoundOrders).where(inArray(schema.teamRoundOrders.roundId, roundIds)) : [],
    db.select().from(schema.rollLog).where(eq(schema.rollLog.gameId, gameId)),
    db.select().from(schema.auditLog).where(eq(schema.auditLog.gameId, gameId)),
  ]);
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    game,
    ruleset: ruleset[0]?.data ?? null,
    assets: assets.map(({ data, ...a }) => ({ ...a, base64: Buffer.from(data).toString("base64") })),
    teams,
    players,
    regions,
    connections,
    units,
    inventory,
    regionKnowledge,
    connectionKnowledge,
    detections,
    contacts,
    trades,
    rounds,
    orders,
    roundOrders,
    rolls,
    audit,
  };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Quote everything, and stop spreadsheets reading a value as a formula.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
}

function csv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const CSV_TABLES = ["teams", "units", "regions", "orders", "rolls", "resources"] as const;
export type CsvTable = (typeof CSV_TABLES)[number];

export async function exportCsv(gameId: string, table: CsvTable): Promise<string | null> {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) return null;
  const [{ ruleset }, teams, regions] = await Promise.all([
    loadRuleset(gameId),
    db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt)),
    db.select().from(schema.regions).where(eq(schema.regions.gameId, gameId)),
  ]);
  const teamName = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? "?") : "");
  const regionCode = (id: string | null) => (id ? (regions.find((r) => r.id === id)?.code ?? "?") : "");
  const res = ruleset.resources.map((r) => r.id);
  switch (table) {
    case "teams":
      return csv(
        ["Team", "NPC", "Base race", "Races", ...ruleset.resources.map((r) => r.name), "Known recipes", "Notes"],
        teams.map((t) => [t.name, t.isNpc ? "yes" : "", t.baseRaceId ?? "", t.raceIds.join(" "), ...res.map((r) => t.resources[r] ?? 0), t.knownRecipeIds.length, t.notes]),
      );
    case "units": {
      const units = await db.select().from(schema.units).where(eq(schema.units.gameId, gameId));
      return csv(
        ["Owner", "Name", "Type", "Race", "Archetype", "HP", "Region", "Status", "Augments"],
        units.map((u) => [
          u.ownerTeamId ? teamName(u.ownerTeamId) : "wild",
          u.name,
          ruleset.creatures.find((c) => c.id === u.creatureId)?.statBlock.name ?? u.creatureId,
          u.raceId ?? "",
          ruleset.archetypes.find((a) => a.id === u.archetypeId)?.name ?? "",
          u.hp,
          regionCode(u.regionId),
          u.status,
          u.augmentIds.map((id) => ruleset.items.find((i) => i.id === id)?.name ?? id).join("; "),
        ]),
      );
    }
    case "regions":
      return csv(
        ["Code", "Name", "Owner", "Settlement", "Buildings", "Hidden", "Description"],
        regions
          .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
          .map((r) => [
            r.code,
            r.name,
            teamName(r.ownerTeamId),
            ruleset.settlementTiers.find((t) => t.id === r.settlementTierId)?.name ?? "",
            r.buildings.map((b) => `${ruleset.buildings.find((x) => x.id === b.buildingId)?.name ?? b.buildingId} ${b.tier}`).join("; "),
            r.hidden ? "yes" : "",
            r.description,
          ]),
      );
    case "orders": {
      const rounds = await db.select().from(schema.rounds).where(eq(schema.rounds.gameId, gameId));
      const orders = rounds.length ? await db.select().from(schema.orders).where(inArray(schema.orders.roundId, rounds.map((r) => r.id))) : [];
      const num = (id: string) => rounds.find((r) => r.id === id)?.number ?? 0;
      return csv(
        ["Round", "Team", "Kind", "Slot", "Action", "Status", "Notes", "Outcome"],
        orders
          .sort((a, b) => num(a.roundId) - num(b.roundId) || a.position - b.position)
          .map((o) => [num(o.roundId), teamName(o.teamId), o.kind, o.slot ?? "", ruleset.actionTypes.find((a) => a.id === o.actionTypeId)?.name ?? o.actionTypeId, o.status, o.notes, (o.outcome as { text?: string } | null)?.text ?? ""]),
      );
    }
    case "rolls": {
      const [rolls, rounds] = await Promise.all([
        db.select().from(schema.rollLog).where(eq(schema.rollLog.gameId, gameId)).orderBy(asc(schema.rollLog.createdAt)),
        db.select().from(schema.rounds).where(eq(schema.rounds.gameId, gameId)),
      ]);
      return csv(
        ["Round", "Label", "Expression", "Total", "Breakdown", "Hidden from players", "Seed"],
        rolls.map((r) => [rounds.find((x) => x.id === r.roundId)?.number ?? "", r.label, r.expression, r.total, (r.result as { breakdown?: string })?.breakdown ?? "", r.hiddenFromPlayers ? "yes" : "", r.seed]),
      );
    }
    case "resources": {
      const rounds = await db.select().from(schema.rounds).where(eq(schema.rounds.gameId, gameId)).orderBy(asc(schema.rounds.number));
      const rows: unknown[][] = [];
      for (const r of rounds) {
        const snap = r.snapshot as { teams?: { id: string; resources: Record<string, number> }[] } | null;
        for (const t of snap?.teams ?? []) rows.push([r.number, teamName(t.id), ...res.map((id) => t.resources[id] ?? 0)]);
      }
      return csv(["Round (after publishing)", "Team", ...ruleset.resources.map((r) => r.name)], rows);
    }
  }
}
