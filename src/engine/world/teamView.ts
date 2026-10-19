import { clipToAreas, type Piece } from "../geo/clip";
import type { Polygon } from "../geo/polygon";
import type { Ruleset } from "../ruleset/ruleset";
import type { Effect } from "../ruleset/effects";
import { computeVisibility, regionMemory, type RegionState } from "./visibility";
import type { MapScale, RegionMemory, TeamKnowledge, WorldConnection, WorldRegion, WorldTerrainArea, WorldUnit } from "./types";

// The one object a team's browser receives: its own state in full, plus only
// what fog of war lets it see of everything else. Built on the server.

export interface ViewRegion {
  id: string;
  code: string;
  x: number;
  y: number;
  /** visible = seen now; remembered = last-known info; frontier = known to exist, never seen. */
  state: RegionState;
  /** The outline (unexplored regions too: their shape, but nothing about them). */
  polygon: Polygon;
  name: string;
  description: string;
  settleable: boolean | null;
  ownerTeamId: string | null;
  settlementTierId: string | null;
  buildings: WorldRegion["buildings"];
  structures: RegionMemory["structures"];
  deposits: RegionMemory["deposits"];
  features: Effect[];
  /** For remembered regions: the round the team last saw it. */
  lastSeenRound: number | null;
}

/** Another side's unit: only its type and owner. */
export interface ViewOtherUnit {
  id: string;
  creatureId: string;
  creatureName: string;
  /** Null = wild monster. */
  ownerTeamId: string | null;
  regionId: string;
  /** Where it stands; null = the region's centre. */
  x: number | null;
  y: number | null;
  dead: boolean;
}

/** Difficult ground, cut down to the parts inside regions the team sees or remembers. */
export interface ViewTerrain {
  id: string;
  terrainId: string;
  pieces: Piece[];
}

export interface ViewTeam {
  id: string;
  name: string;
  colour: string;
  isNpc: boolean;
  /** Team emblem ID (src/components/icons/emblems.ts); empty = not picked. */
  emblem?: string;
}

export interface OwnTeam extends ViewTeam {
  resources: Record<string, number>;
  baseRaceId: string | null;
  raceIds: string[];
  knownRecipeIds: string[];
  secretObjectives: string;
}

export interface TeamView {
  team: OwnTeam;
  /** Other teams that appear somewhere in this view. */
  teams: ViewTeam[];
  regions: ViewRegion[];
  connections: WorldConnection[];
  ownUnits: WorldUnit[];
  otherUnits: ViewOtherUnit[];
  terrain: ViewTerrain[];
  map: MapScale;
  inventory: Record<string, number>;
  round: number;
}

export interface TeamViewInput {
  ruleset: Ruleset;
  regions: WorldRegion[];
  connections: WorldConnection[];
  units: WorldUnit[];
  teams: (ViewTeam & Partial<OwnTeam>)[];
  team: OwnTeam;
  knowledge: TeamKnowledge;
  terrain: WorldTerrainArea[];
  map: MapScale;
  inventory: Record<string, number>;
  round: number;
}

export function buildTeamView(input: TeamViewInput): TeamView {
  const { ruleset, team, knowledge } = input;
  const vis = computeVisibility(ruleset, input, team.id, knowledge);
  const creatureName = (id: string) => ruleset.creatures.find((c) => c.id === id)?.statBlock.name ?? id;

  const regions: ViewRegion[] = [];
  for (const reg of input.regions) {
    const state = vis.regions.get(reg.id);
    if (!state) continue;
    const base = { id: reg.id, code: reg.code, x: reg.x, y: reg.y, polygon: reg.polygon, state, lastSeenRound: null };
    if (state === "visible") {
      regions.push({ ...base, ...regionMemory(reg), settleable: reg.settleable, features: reg.features });
    } else if (state === "remembered") {
      const k = knowledge.regions.get(reg.id)!;
      regions.push({ ...base, ...k.lastSeen!, settleable: null, features: [], lastSeenRound: k.lastSeenRound });
    } else {
      regions.push({
        ...base,
        name: "",
        description: "",
        settleable: null,
        ownerTeamId: null,
        settlementTierId: null,
        buildings: [],
        structures: [],
        deposits: [],
        features: [],
      });
    }
  }

  const ownUnits = input.units.filter((u) => vis.ownUnits.has(u.id));
  const otherUnits: ViewOtherUnit[] = input.units
    .filter((u) => vis.otherUnits.has(u.id))
    .map((u) => ({
      id: u.id,
      creatureId: u.creatureId,
      creatureName: creatureName(u.creatureId),
      ownerTeamId: u.ownerTeamId,
      regionId: u.regionId!,
      x: u.x,
      y: u.y,
      dead: u.status === "dead",
    }));

  // Terrain only where the team can see (or remembers seeing), so nothing about unseen ground leaks.
  const seen = regions.filter((r) => r.state !== "frontier" && r.polygon.length >= 3).map((r) => r.polygon);
  const terrain = input.terrain.map((a) => ({ id: a.id, terrainId: a.terrainId, pieces: clipToAreas(a.polygon, seen) })).filter((a) => a.pieces.length);

  const teamIds = new Set<string>();
  for (const reg of regions) if (reg.ownerTeamId) teamIds.add(reg.ownerTeamId);
  for (const u of otherUnits) if (u.ownerTeamId) teamIds.add(u.ownerTeamId);
  teamIds.delete(team.id);
  const teams = input.teams.filter((t) => teamIds.has(t.id)).map(({ id, name, colour, isNpc, emblem }) => ({ id, name, colour, isNpc, emblem }));

  return {
    team,
    teams,
    regions,
    connections: input.connections
      .filter((c) => vis.connections.has(c.id))
      .map(({ id, regionA, regionB, kind, blocked, miles, terrainId, hidden }) => ({ id, regionA, regionB, kind, blocked, miles, terrainId, hidden })),
    ownUnits,
    otherUnits,
    terrain,
    map: input.map,
    inventory: input.inventory,
    round: input.round,
  };
}

/** Memories to store for every region the team sees right now. */
export function memoriesToRecord(view: TeamView, regions: WorldRegion[]): { regionId: string; memory: RegionMemory }[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  return view.regions.filter((r) => r.state === "visible").map((r) => ({ regionId: r.id, memory: regionMemory(byId.get(r.id)!) }));
}

/**
 * The parts of the ruleset a team may read. Roll-table outcomes, the monster
 * library and recipes the team hasn't learned stay on the server.
 */
export function playerRuleset(r: Ruleset, opts: { metCreatureIds: Iterable<string>; ownCreatureIds: Iterable<string>; knownRecipeIds: Iterable<string> }): Ruleset {
  const creatures = new Set([...opts.metCreatureIds, ...opts.ownCreatureIds]);
  const recipes = new Set(opts.knownRecipeIds);
  return {
    ...r,
    creatures: r.creatures.filter((c) => c.recruitable || creatures.has(c.id)),
    recipes: r.recipes.filter((x) => x.knownAtStart || recipes.has(x.id)),
    rollTables: r.rollTables.map((t) => ({ ...t, bands: [{ min: 1, max: null, text: "", results: [] }] })),
  };
}
