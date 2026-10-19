import type { Effect } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import { unitBonuses } from "../ruleset/derive";
import { ACTIVE_STATUSES, ON_MAP_STATUSES, type RegionMemory, type TeamKnowledge, type WorldConnection, type WorldRegion, type WorldUnit } from "./types";

// Fog of war: what one team can see. Always computed on the server, from the
// full game state, before anything is sent to that team's browser.
//
// A team sees a region if it owns it, has a unit in it, has been granted
// permanent vision of it, or it's within vision range of one of the team's
// units or buildings that grant vision. Hidden regions and connections need to
// have been discovered first. Stealthed units of other teams stay invisible
// until this team has detected them.

export type RegionState = "visible" | "remembered" | "frontier";

export interface Visibility {
  /** Every region the team gets sent, and how much of it they see. */
  regions: Map<string, RegionState>;
  /** Connections the team gets sent. */
  connections: Set<string>;
  /** Units of other teams (and wild monsters) the team can see. */
  otherUnits: Set<string>;
  /** The team's own units. */
  ownUnits: Set<string>;
}

function visionFromEffects(effects: Effect[]): number {
  let best = 0;
  for (const e of effects) if (e.type === "vision") best = Math.max(best, e.range);
  return best;
}

/** How many regions away a unit can see (0 = its own region only). */
export function unitVisionRange(r: Ruleset, u: WorldUnit): number {
  const creature = r.creatures.find((c) => c.id === u.creatureId);
  const archetype = r.archetypes.find((a) => a.id === u.archetypeId);
  const base = archetype?.visionRange ?? creature?.visionRange ?? 0;
  const fromBonuses = visionFromEffects([...(creature?.effects ?? []), ...unitBonuses(r, u).flatMap((b) => b.effects ?? [])]);
  return Math.max(base, fromBonuses);
}

/** Vision granted by a team-owned region's settlement, buildings and features. */
export function regionVisionRange(r: Ruleset, region: WorldRegion): number {
  const effects: Effect[] = [...region.features];
  const tier = r.settlementTiers.find((t) => t.id === region.settlementTierId);
  if (tier) effects.push(...tier.effects);
  for (const b of region.buildings) {
    const def = r.buildings.find((x) => x.id === b.buildingId);
    // A building's effects are those of its current tier.
    const t = def?.tiers[Math.min(b.tier, def.tiers.length) - 1];
    if (t) effects.push(...t.effects);
  }
  return visionFromEffects(effects);
}

export function computeVisibility(
  r: Ruleset,
  world: { regions: WorldRegion[]; connections: WorldConnection[]; units: WorldUnit[] },
  teamId: string,
  knowledge: TeamKnowledge,
): Visibility {
  const regionById = new Map(world.regions.map((x) => [x.id, x]));
  const knownRegion = (id: string) => {
    const reg = regionById.get(id);
    return Boolean(reg && (!reg.hidden || knowledge.regions.get(id)?.discovered));
  };
  const known = (c: WorldConnection) => !c.hidden || knowledge.connections.has(c.id);
  // A blocked border is as if the regions weren't neighbours: no moving or seeing across it.
  const usable = (c: WorldConnection) => !c.blocked && known(c);

  const neighbours = new Map<string, string[]>();
  for (const c of world.connections) {
    if (!usable(c)) continue;
    neighbours.set(c.regionA, [...(neighbours.get(c.regionA) ?? []), c.regionB]);
    neighbours.set(c.regionB, [...(neighbours.get(c.regionB) ?? []), c.regionA]);
  }

  const visible = new Set<string>();
  /** Vision sources: region id → range. */
  const sources = new Map<string, number>();
  const addSource = (regionId: string, range: number) => sources.set(regionId, Math.max(sources.get(regionId) ?? 0, range));

  for (const reg of world.regions) {
    if (reg.ownerTeamId === teamId) {
      visible.add(reg.id);
      addSource(reg.id, regionVisionRange(r, reg));
    }
    if (knowledge.regions.get(reg.id)?.permanentVision) visible.add(reg.id);
  }
  const ownUnits = new Set<string>();
  for (const u of world.units) {
    if (u.ownerTeamId !== teamId) continue;
    ownUnits.add(u.id);
    if (!u.regionId || !ACTIVE_STATUSES.has(u.status) || !regionById.has(u.regionId)) continue;
    visible.add(u.regionId);
    addSource(u.regionId, unitVisionRange(r, u));
  }

  // Spread vision outwards along the connections the team knows about.
  for (const [start, range] of sources) {
    let frontier = [start];
    const seen = new Set(frontier);
    for (let step = 0; step < range; step++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of neighbours.get(id) ?? []) {
          if (seen.has(n) || !knownRegion(n)) continue;
          seen.add(n);
          visible.add(n);
          next.push(n);
        }
      }
      frontier = next;
    }
  }

  const regions = new Map<string, RegionState>();
  for (const id of visible) regions.set(id, "visible");
  if (r.settings.fog.showPreviouslySeen) {
    for (const [id, k] of knowledge.regions) {
      if (!regions.has(id) && k.lastSeen && knownRegion(id)) regions.set(id, "remembered");
    }
  }
  // Regions next to a visible one show up as unexplored, so the team can plan moves into them.
  for (const id of visible) {
    for (const n of neighbours.get(id) ?? []) if (!regions.has(n) && knownRegion(n)) regions.set(n, "frontier");
  }

  // Sent to the team: the ways it knows about, and blocked borders it can see (to draw them).
  const connections = new Set<string>();
  for (const c of world.connections) {
    if (!known(c)) continue;
    const a = regions.get(c.regionA);
    const b = regions.get(c.regionB);
    if (!a || !b || (a === "frontier" && b === "frontier")) continue;
    connections.add(c.id);
  }

  const otherUnits = new Set<string>();
  for (const u of world.units) {
    if (u.ownerTeamId === teamId || !u.regionId || !ON_MAP_STATUSES.has(u.status)) continue;
    if (!visible.has(u.regionId)) continue;
    if (u.status === "hidden" && !knowledge.detectedUnits.has(u.id)) continue;
    otherUnits.add(u.id);
  }

  return { regions, connections, otherUnits, ownUnits };
}

/** What a team will remember about a region it's looking at now. */
export function regionMemory(reg: WorldRegion): RegionMemory {
  return {
    name: reg.name,
    description: reg.description,
    ownerTeamId: reg.ownerTeamId,
    settlementTierId: reg.settlementTierId,
    buildings: reg.buildings,
    structures: reg.structures.filter((s) => !s.hidden).map(({ kind, name, description, searched }) => ({ kind, name, description, searched })),
    deposits: reg.deposits.filter((d) => !d.hidden).map(({ id, name, note, production }) => ({ id, name, note, production })),
  };
}
