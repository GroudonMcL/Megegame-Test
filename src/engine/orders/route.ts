import { boundaryHits, length, lerp, pointInPolygon, type Polygon, type Pt } from "../geo/polygon";
import { traceSegment, type ShapeIndex } from "../geo/regions";
import type { Ruleset } from "../ruleset/ruleset";
import type { MapScale, WorldConnection } from "../world/types";
import { milesPerRound, modeMultiplier, MOVE_EPSILON, terrainFactor, unitSpeeds, type GroupMember, type MoveMode } from "./movement";

// Movement on the region map. A move's path is a list of points on the map
// (fractions of its width and height), plus "take this link" steps for
// tunnels and sea lanes. The group walks in straight lines from point to
// point; the miles it uses are the length on the map times the map's scale,
// more for the stretches inside difficult terrain. Crossing from one region
// into another needs an open border between them. Entering a region is what
// the rules care about (monsters attack, stealth rolls…), so the route reports
// each region it enters, and where.

/** One step of a path: walk to a point, or take a link to the region at its other end. */
export type PathStep = Pt | { link: string };

/** A stored path input, cleaned up: anything that isn't a point or a link step is dropped. */
export function parsePath(v: unknown): PathStep[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s): PathStep[] => {
    if (Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === "number" && Number.isFinite(n))) return [[s[0], s[1]]];
    if (s && typeof s === "object" && typeof (s as { link?: unknown }).link === "string") return [{ link: (s as { link: string }).link }];
    return [];
  });
}

/** Difficult ground: outline rings (filled by the even-odd rule, so holes work). */
export interface TerrainShape {
  terrainId: string;
  rings: Polygon[];
}

/** What the route can see of the map. */
export interface RouteMap {
  /** The regions the mover knows the shape of. */
  index: ShapeIndex;
  centre: (regionId: string) => Pt | null;
  /** A region's name for messages. */
  label: (regionId: string) => string;
  /** The ways the mover knows of (borders and links), blocked ones included. */
  connections: WorldConnection[];
  /**
   * On a team's view: does the team know every border of this region (it can
   * see it now)? Between regions it doesn't, a missing border may just be one
   * it hasn't found, so the route goes on and the DM checks it.
   */
  knowsBorders?: (regionId: string) => boolean;
  terrain: TerrainShape[];
  scale: MapScale;
  /**
   * True for a team's own (fogged) view: ground outside every known region may
   * be regions it hasn't seen, so the route goes on as "unknown ground" and the
   * real check happens when the DM resolves the round. False for the real map:
   * ground outside every region is open ground nobody can cross.
   */
  partial: boolean;
}

export interface RouteResult {
  /** The regions entered, in order, and where; null = unknown ground (partial maps only). */
  entered: { regionId: string | null; at: Pt }[];
  /** Where the group ends up, and in which region (null = unknown ground). */
  end: Pt;
  endRegion: string | null;
  /** Fraction of the round's movement each unit has used, after this move. */
  used: number[];
  /** Miles each unit walked on this move. */
  miles: number[];
  /** Why the move stopped before the end of its path, if it did. */
  blocked?: string;
  /** The move stopped because a unit ran out of movement. */
  outOfMovement?: boolean;
  /** Part of the route is through ground the team doesn't know. */
  unknown: boolean;
  /** The points actually walked, for drawing: start, each corner reached, end. */
  walked: Pt[];
}

/** Is p inside the terrain shape (even-odd over its rings)? */
function insideTerrain(p: Pt, t: TerrainShape): boolean {
  let inside = false;
  for (const ring of t.rings) if (pointInPolygon(p, ring)) inside = !inside;
  return inside;
}

/** A point a little past `at` in the direction a → b (so a unit that stops on entering is clearly inside). */
function nudge(a: Pt, b: Pt, at: Pt, aspect: number): Pt {
  const len = length(a, b, aspect);
  if (len === 0) return at;
  const step = Math.min(0.004 / len, 1);
  const t = Math.min(1, length(a, at, aspect) / len + step);
  return lerp(a, b, t);
}

export function traceRoute(
  r: Ruleset,
  map: RouteMap,
  start: Pt,
  startRegion: string | null,
  steps: PathStep[],
  group: GroupMember[],
  mode: MoveMode,
  /** Called on entering each region; return true to stop the move there. */
  onEnter?: (regionId: string, at: Pt) => boolean,
): RouteResult {
  const speeds = group.map((g) => unitSpeeds(r, g.unit));
  const groupExplorer = speeds.some((s) => s?.explorer === "group");
  const budget = group.map((g) => milesPerRound(r, g.unit) * modeMultiplier(r, mode));
  const used = group.map((g) => g.used);
  const miles = group.map(() => 0);
  const entered: RouteResult["entered"] = [];
  // The corners reached so far (the current position is added at the end).
  const walked: Pt[] = [];
  let at = start;
  let region = startRegion;
  let unknown = false;
  const name = (i: number) => group[i].unit.name || "A unit";

  const pair = (a: string, b: string) => map.connections.find((c) => (c.regionA === a && c.regionB === b) || (c.regionA === b && c.regionB === a));
  const done = (extra: Partial<RouteResult> = {}): RouteResult => ({ entered, end: at, endRegion: region, used, miles, unknown, walked: [...walked, at], ...extra });

  if (speeds.some((s) => !s)) return done({ blocked: `${name(speeds.findIndex((s) => !s))} has no stat block` });
  if (budget.some((b) => b <= 0)) return done({ blocked: `${name(budget.findIndex((b) => b <= 0))} can't move` });

  /** Charge each unit for `len` miles at its own terrain factors; returns the share (0–1) walked before the first unit runs out. */
  const charge = (len: number, factors: number[]): number => {
    let share = 1;
    factors.forEach((f, i) => {
      const cost = (len * f) / budget[i];
      if (cost > 0 && used[i] + cost > 1 + MOVE_EPSILON) share = Math.min(share, Math.max(0, (1 - used[i]) / cost));
    });
    factors.forEach((f, i) => {
      used[i] += ((len * f) / budget[i]) * share;
      miles[i] += len * f * share;
    });
    return share;
  };

  /** Each unit's cost factor for terrain with these types, or why someone can't enter it. */
  const factorsFor = (terrainIds: string[]): { factors: number[] } | { blocked: string } => {
    const factors = group.map(() => 1);
    for (const id of terrainIds) {
      for (let i = 0; i < group.length; i++) {
        const f = terrainFactor(r, id, speeds[i]!, groupExplorer);
        if ("blocked" in f) return { blocked: `${name(i)} can't go on: ${f.blocked}` };
        factors[i] = Math.max(factors[i], f.factor);
      }
    }
    return { factors };
  };

  for (const step of steps) {
    if (!Array.isArray(step)) {
      // A link: from the region it starts in to the region at its other end.
      const c = map.connections.find((x) => x.id === step.link);
      if (!c || c.blocked || !region || (c.regionA !== region && c.regionB !== region)) return done({ blocked: "That way isn't open from here" });
      const to = c.regionA === region ? c.regionB : c.regionA;
      const from = map.centre(region);
      const dest = map.centre(to);
      if (!dest) return done({ blocked: "That way leads somewhere unknown" });
      const len = c.miles ?? (from ? length(from, dest, map.scale.aspect) * map.scale.milesAcross : 0);
      const f = factorsFor([c.terrainId]);
      if ("blocked" in f) return done({ blocked: f.blocked });
      if (charge(len, f.factors) < 1) return done({ outOfMovement: true });
      walked.push(at);
      at = dest;
      region = to;
      entered.push({ regionId: to, at: dest });
      if (onEnter?.(to, dest)) return done();
      continue;
    }

    const a = at;
    const b = step;
    const segMiles = length(a, b, map.scale.aspect) * map.scale.milesAcross;
    if (segMiles === 0) continue;
    walked.push(a);
    // Break the line wherever it changes region or crosses a terrain edge.
    const stretches = traceSegment(map.index, a, b);
    const ts = new Set<number>([0, 1]);
    for (const s of stretches) ts.add(s.t0).add(s.t1);
    for (const t of map.terrain) for (const ring of t.rings) for (const h of boundaryHits(a, b, ring)) ts.add(h);
    const cuts = [...ts].sort((x, y) => x - y);

    for (let k = 1; k < cuts.length; k++) {
      const t0 = cuts[k - 1];
      const t1 = cuts[k];
      if (t1 - t0 < 1e-9) continue;
      const mid = lerp(a, b, (t0 + t1) / 2);
      const here = stretches.find((s) => s.t0 <= (t0 + t1) / 2 && (t0 + t1) / 2 <= s.t1)?.regionId ?? null;
      const entry = lerp(a, b, t0);

      if (here !== region) {
        if (here === null) {
          if (!map.partial) {
            at = entry;
            return done({ blocked: "There's no way across open ground" });
          }
          unknown = true;
        } else if (region !== null) {
          const c = pair(region, here);
          const unsure = map.partial && !c && !(map.knowsBorders?.(region) && map.knowsBorders?.(here));
          if (unsure) unknown = true;
          else if (!c || c.blocked || c.kind !== "border") {
            at = entry;
            return done({ blocked: c?.blocked ? `The border between ${map.label(region)} and ${map.label(here)} is blocked` : `There's no way from ${map.label(region)} into ${map.label(here)}` });
          }
        } else {
          unknown = true;
        }
        at = entry;
        region = here;
        if (here !== null) {
          const inside = nudge(a, b, entry, map.scale.aspect);
          entered.push({ regionId: here, at: inside });
          if (onEnter?.(here, inside)) {
            at = inside;
            return done();
          }
        } else entered.push({ regionId: null, at: entry });
      }

      const terrainHere = map.terrain.filter((t) => insideTerrain(mid, t)).map((t) => t.terrainId);
      const f = factorsFor(terrainHere);
      if ("blocked" in f) {
        at = entry;
        return done({ blocked: f.blocked });
      }
      const share = charge((t1 - t0) * segMiles, f.factors);
      if (share < 1) {
        at = lerp(a, b, t0 + (t1 - t0) * share);
        return done({ outOfMovement: true });
      }
    }
    at = b;
  }
  return done();
}
