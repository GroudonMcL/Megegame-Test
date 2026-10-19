import { fmtRes } from "./ruleset/effects";
import type { Ruleset } from "./ruleset/ruleset";
import type { Change, World } from "./resolve/types";
import { ACTIVE_STATUSES } from "./world/types";

// Trades between teams that have met. A team offers a bundle and asks for one
// in return; once the other team accepts, the trade executes at the end of the
// round, but only if both sides still have what they promised.

export interface TradeBundle {
  resources: Record<string, number>;
  items: Record<string, number>;
  recipeIds: string[];
  raceIds: string[];
  unitIds: string[];
  regionIds: string[];
  /** Share everything this team knows of the map. */
  map: boolean;
}

export const EMPTY_BUNDLE: TradeBundle = { resources: {}, items: {}, recipeIds: [], raceIds: [], unitIds: [], regionIds: [], map: false };

export interface TradeInput {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  give: TradeBundle;
  get: TradeBundle;
}

/** A change the database applies that the in-memory world doesn't track. */
export type TradeChange = Change | { type: "shareMap"; fromTeamId: string; toTeamId: string };

export interface TradeOutcome {
  tradeId: string;
  ok: boolean;
  problems: string[];
  changes: TradeChange[];
  /** "Blue Team gave 5 Gold and a Guard; Red Team gave 2 Metal." */
  summary: string;
}

export function isEmpty(b: TradeBundle): boolean {
  return (
    !Object.values(b.resources).some((v) => v > 0) &&
    !Object.values(b.items).some((v) => v > 0) &&
    !b.recipeIds.length &&
    !b.raceIds.length &&
    !b.unitIds.length &&
    !b.regionIds.length &&
    !b.map
  );
}

/** "5 Gold, 2× Metal, the Guard “Iron Fist”, region A3, their map". */
export function describeBundle(r: Ruleset, world: Pick<World, "units" | "regions">, b: TradeBundle, mapOf = "their"): string {
  const parts: string[] = [];
  const res = Object.fromEntries(Object.entries(b.resources).filter(([, v]) => v > 0));
  if (Object.keys(res).length) parts.push(fmtRes(res, r.resources));
  for (const [id, q] of Object.entries(b.items)) if (q > 0) parts.push(`${q > 1 ? `${q}× ` : ""}${r.items.find((x) => x.id === id)?.name ?? id}`);
  for (const id of b.recipeIds) {
    const recipe = r.recipes.find((x) => x.id === id);
    parts.push(`the recipe for ${recipe ? recipe.outputs.map((o) => r.items.find((x) => x.id === o.itemId)?.name ?? o.itemId).join(" + ") : id}`);
  }
  for (const id of b.raceIds) parts.push(`the ${r.races.find((x) => x.id === id)?.name ?? id} race`);
  for (const id of b.unitIds) {
    const u = world.units.find((x) => x.id === id);
    const type = u ? (r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name ?? "unit") : "a unit";
    parts.push(u?.name && u.name !== type ? `the ${type} “${u.name}”` : `a ${type}`);
  }
  for (const id of b.regionIds) {
    const reg = world.regions.find((x) => x.id === id);
    parts.push(`region ${reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "?"}`);
  }
  if (b.map) parts.push(`a copy of ${mapOf} map`);
  return parts.length ? parts.join(", ") : "nothing";
}

/** Checks one side can hand over its bundle, and lists the changes that move it to the other side. */
function transfer(r: Ruleset, world: World, from: string, to: string, b: TradeBundle, problems: string[], changes: TradeChange[]) {
  const team = world.teams.find((t) => t.id === from);
  const name = team?.name ?? "A team";
  if (!team) {
    problems.push("A team in the trade no longer exists.");
    return;
  }
  const res = Object.fromEntries(Object.entries(b.resources).filter(([, v]) => v > 0));
  for (const [id, v] of Object.entries(res)) {
    if ((team.resources[id] ?? 0) < v) problems.push(`${name} doesn't have ${v} ${r.resources.find((x) => x.id === id)?.name ?? id}.`);
  }
  if (Object.keys(res).length) {
    changes.push({ type: "resources", teamId: from, delta: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, -v])) });
    changes.push({ type: "resources", teamId: to, delta: res });
  }
  for (const [id, q] of Object.entries(b.items)) {
    if (q <= 0) continue;
    if ((world.inventory[from]?.[id] ?? 0) < q) problems.push(`${name} doesn't have ${q}× ${r.items.find((x) => x.id === id)?.name ?? id}.`);
    changes.push({ type: "inventory", teamId: from, itemId: id, delta: -q });
    changes.push({ type: "inventory", teamId: to, itemId: id, delta: q });
  }
  if (b.recipeIds.length) {
    for (const id of b.recipeIds) {
      const known = team.knownRecipeIds.includes(id) || r.recipes.find((x) => x.id === id)?.knownAtStart;
      if (!known) problems.push(`${name} doesn't know that recipe.`);
    }
    changes.push({ type: "learnRecipes", teamId: to, recipeIds: b.recipeIds });
  }
  if (b.raceIds.length) {
    for (const id of b.raceIds) {
      if (id === team.baseRaceId) problems.push(`${name} can't trade away its base race.`);
      else if (!team.raceIds.includes(id)) problems.push(`${name} doesn't have the ${r.races.find((x) => x.id === id)?.name ?? id} race.`);
    }
    changes.push({ type: "gainRaces", teamId: to, raceIds: b.raceIds });
  }
  for (const id of b.unitIds) {
    const u = world.units.find((x) => x.id === id);
    if (!u || u.ownerTeamId !== from || !ACTIVE_STATUSES.has(u.status)) problems.push(`${name} no longer has one of the units it offered.`);
    else changes.push({ type: "updateUnit", unitId: id, patch: { ownerTeamId: to } });
  }
  for (const id of b.regionIds) {
    const reg = world.regions.find((x) => x.id === id);
    if (!reg || reg.ownerTeamId !== from) problems.push(`${name} no longer owns ${reg ? reg.code : "a region it offered"}.`);
    else changes.push({ type: "updateRegion", regionId: id, patch: { ownerTeamId: to } });
  }
  if (b.map) changes.push({ type: "shareMap", fromTeamId: from, toTeamId: to });
}

export function executeTrade(r: Ruleset, world: World, t: TradeInput): TradeOutcome {
  const problems: string[] = [];
  const changes: TradeChange[] = [];
  transfer(r, world, t.fromTeamId, t.toTeamId, t.give, problems, changes);
  transfer(r, world, t.toTeamId, t.fromTeamId, t.get, problems, changes);
  const name = (id: string) => world.teams.find((x) => x.id === id)?.name ?? "?";
  const summary = `${name(t.fromTeamId)} gave ${describeBundle(r, world, t.give, "its")}; ${name(t.toTeamId)} gave ${describeBundle(r, world, t.get, "its")}.`;
  return { tradeId: t.id, ok: problems.length === 0, problems, changes: problems.length ? [] : changes, summary };
}
