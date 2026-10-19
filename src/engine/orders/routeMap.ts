import { mapScaleOf } from "../geo/mapSize";
import { indexShapes } from "../geo/regions";
import type { World } from "../resolve/types";
import type { TeamView } from "../world/teamView";
import type { RouteMap } from "./route";

// The map a move is traced on: what the team knows (when checking orders as
// they're written), or the real thing (when the DM resolves the round).

/** A team's view: its known regions (unexplored ones too, as shapes), and unknown ground beyond. */
export function routeMapFromView(view: TeamView): RouteMap {
  const byId = new Map(view.regions.map((r) => [r.id, r]));
  return {
    index: indexShapes(view.regions.map((r) => ({ id: r.id, polygon: r.polygon }))),
    centre: (id) => {
      const r = byId.get(id);
      return r ? [r.x, r.y] : null;
    },
    label: (id) => {
      const r = byId.get(id);
      return !r ? "an unknown region" : r.state === "frontier" ? `${r.code} (unexplored)` : r.name ? `${r.code} ${r.name}` : r.code;
    },
    connections: view.connections,
    knowsBorders: (id) => byId.get(id)?.state === "visible",
    terrain: view.terrain.flatMap((t) => t.pieces.map((rings) => ({ terrainId: t.terrainId, rings }))),
    scale: view.map,
    partial: true,
  };
}

/** The real map, as one team's units can travel it: hidden ways it hasn't discovered stay shut. */
export function routeMapFromWorld(world: World, teamId: string): RouteMap {
  const byId = new Map(world.regions.map((r) => [r.id, r]));
  const known = new Set(world.knownConnections?.[teamId] ?? []);
  return {
    index: indexShapes(world.regions.map((r) => ({ id: r.id, polygon: r.polygon }))),
    centre: (id) => {
      const r = byId.get(id);
      return r ? [r.x, r.y] : null;
    },
    label: (id) => {
      const r = byId.get(id);
      return !r ? "?" : r.name ? `${r.code} ${r.name}` : r.code;
    },
    connections: world.connections.filter((c) => !c.hidden || known.has(c.id)),
    terrain: (world.terrain ?? []).map((t) => ({ terrainId: t.terrainId, rings: [t.polygon] })),
    scale: mapScaleOf(world),
    partial: false,
  };
}
