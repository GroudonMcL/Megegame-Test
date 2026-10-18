import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { OrderDraft } from "@/engine/orders/validate";
import { buildTeamView, memoriesToRecord, playerRuleset, type TeamView } from "@/engine/world/teamView";
import type { RegionMemory, TeamKnowledge, WorldConnection, WorldRegion, WorldUnit } from "@/engine/world/types";
import { fogHoles, fogKey } from "./fogImage";
import { loadMapState } from "./map";
import { loadRuleset } from "./rulesets";

// Loads the whole game state, then cuts it down to what one team may see.
// Nothing from here reaches a browser except the returned view and the
// player ruleset.

export interface LoadedTeamView {
  view: TeamView;
  /** The parts of the ruleset this team may read. */
  rules: Ruleset;
  /** The full ruleset, for server-side use only. */
  fullRuleset: Ruleset;
  /** The fogged map image (the URL changes whenever the fog does). */
  mapImage: { width: number; height: number; url: string } | null;
  round: typeof schema.rounds.$inferSelect | null;
  orderState: typeof schema.teamRoundOrders.$inferSelect | null;
  orders: OrderDraft[];
}

export function toWorldRegion(r: typeof schema.regions.$inferSelect): WorldRegion {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    x: r.x,
    y: r.y,
    settleable: r.settleable,
    hidden: r.hidden,
    ownerTeamId: r.ownerTeamId,
    settlementTierId: r.settlementTierId,
    buildings: r.buildings,
    structures: r.structures,
    deposits: r.deposits,
    features: r.features as WorldRegion["features"],
  };
}

export function toWorldUnit(u: typeof schema.units.$inferSelect): WorldUnit {
  return {
    id: u.id,
    ownerTeamId: u.ownerTeamId,
    creatureId: u.creatureId,
    name: u.name,
    raceId: u.raceId,
    archetypeId: u.archetypeId,
    academyBonus: u.academyBonus,
    augmentIds: u.augmentIds,
    hp: u.hp,
    regionId: u.regionId,
    milesUsed: u.milesUsed,
    status: u.status,
    isLeader: u.isLeader,
  };
}

/**
 * record = remember what the team sees now (last-seen info and monsters met).
 * The DM's "view as team" passes false, so looking never changes a team's memory.
 */
export async function loadTeamView(gameId: string, teamId: string, opts: { record: boolean }): Promise<LoadedTeamView> {
  const [state, { ruleset }, [game], [team], regionKnowledge, connectionKnowledge, detections, inventoryRows] = await Promise.all([
    loadMapState(gameId),
    loadRuleset(gameId),
    db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1),
    db.select().from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId))).limit(1),
    db.select().from(schema.teamRegionKnowledge).where(eq(schema.teamRegionKnowledge.teamId, teamId)),
    db.select().from(schema.teamConnectionKnowledge).where(eq(schema.teamConnectionKnowledge.teamId, teamId)),
    db.select().from(schema.teamUnitDetections).where(eq(schema.teamUnitDetections.teamId, teamId)),
    db.select().from(schema.inventory).where(eq(schema.inventory.teamId, teamId)),
  ]);
  if (!game || !team) throw new Error("Team not found in this game");

  const knowledge: TeamKnowledge = {
    regions: new Map(
      regionKnowledge.map((k) => [
        k.regionId,
        { discovered: k.discovered, searched: k.searched, permanentVision: k.permanentVision, lastSeen: (k.lastSeen as RegionMemory | null) ?? null, lastSeenRound: k.lastSeenRound },
      ]),
    ),
    connections: new Set(connectionKnowledge.map((k) => k.connectionId)),
    detectedUnits: new Set(detections.map((d) => d.unitId)),
  };

  const regions = state.regions.map(toWorldRegion);
  const units = state.units.map(toWorldUnit);
  const view = buildTeamView({
    ruleset,
    regions,
    connections: state.connections as WorldConnection[],
    units,
    teams: state.teams,
    team: {
      id: team.id,
      name: team.name,
      colour: team.colour,
      isNpc: team.isNpc,
      resources: team.resources,
      baseRaceId: team.baseRaceId,
      raceIds: team.raceIds,
      knownRecipeIds: team.knownRecipeIds,
      secretObjectives: team.secretObjectives,
    },
    knowledge,
    inventory: Object.fromEntries(inventoryRows.filter((i) => i.qty > 0).map((i) => [i.itemId, i.qty])),
    round: game.currentRound,
  });

  const seen = new Set(team.seenCreatureIds);
  const newlySeen = [...new Set(view.otherUnits.map((u) => u.creatureId))].filter((id) => !seen.has(id));
  if (opts.record) {
    const memories = memoriesToRecord(view, regions);
    if (memories.length) {
      await db
        .insert(schema.teamRegionKnowledge)
        .values(memories.map((m) => ({ teamId, regionId: m.regionId, discovered: true, lastSeen: m.memory, lastSeenRound: game.currentRound })))
        .onConflictDoUpdate({
          target: [schema.teamRegionKnowledge.teamId, schema.teamRegionKnowledge.regionId],
          set: { discovered: true, lastSeen: sql`excluded.last_seen`, lastSeenRound: sql`excluded.last_seen_round` },
        });
    }
    if (newlySeen.length) {
      await db
        .update(schema.teams)
        .set({ seenCreatureIds: [...seen, ...newlySeen] })
        .where(eq(schema.teams.id, teamId));
    }
  }

  const rules = playerRuleset(ruleset, {
    metCreatureIds: [...seen, ...newlySeen],
    ownCreatureIds: view.ownUnits.map((u) => u.creatureId),
    knownRecipeIds: team.knownRecipeIds,
  });

  const [round] = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.currentRound)))
    .limit(1);
  let orderState: LoadedTeamView["orderState"] = null;
  let orders: OrderDraft[] = [];
  if (round) {
    const [st, rows] = await Promise.all([
      db
        .select()
        .from(schema.teamRoundOrders)
        .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, teamId)))
        .limit(1)
        .then((x) => x[0] ?? null),
      db
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, teamId)))
        .orderBy(asc(schema.orders.position)),
    ]);
    orderState = st;
    orders = rows.map((o) => ({ id: o.id, kind: o.kind as OrderDraft["kind"], actionTypeId: o.actionTypeId, inputs: o.inputs, notes: o.notes }));
  }

  return {
    view,
    rules,
    fullRuleset: ruleset,
    mapImage: state.mapImage
      ? {
          width: state.mapImage.width,
          height: state.mapImage.height,
          url: `/api/play/map?v=${ruleset.settings.fog.fogImage ? fogKey(state.mapImage.id, fogHoles(view), ruleset.settings.fog.revealRadius) : "open"}`,
        }
      : null,
    round: round ?? null,
    orderState,
    orders,
  };
}

/** Can this team change its orders right now? */
export function ordersOpen(round: LoadedTeamView["round"], now = new Date()): { open: boolean; reason: string } {
  if (!round) return { open: false, reason: "No round has been opened yet." };
  if (round.status !== "open") return { open: false, reason: `Round ${round.number} is ${round.status}; orders can't be changed.` };
  if (round.deadline && round.deadline <= now) return { open: false, reason: `The deadline for round ${round.number} has passed.` };
  return { open: true, reason: "" };
}
