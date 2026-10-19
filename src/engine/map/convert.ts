import { length, type Polygon, type Pt } from "../geo/polygon";
import { adjacentPairs } from "../geo/regions";
import { voronoiCells } from "../geo/voronoi";

// Turning an old node map (dots joined by connections) into a region map
// (shapes that are neighbours when they touch), once per game. Pure: the
// caller (scripts/convert-maps.ts) reads the rows and writes the result.

export interface NodeRegion {
  id: string;
  code: string;
  x: number;
  y: number;
  polygon: Polygon;
}

export interface NodeConnection {
  id: string;
  regionA: string;
  regionB: string;
  miles: number | null;
  terrainId: string;
  hidden: boolean;
}

export interface ConversionPlan {
  /** New outlines for regions that had none. */
  polygons: Map<string, Polygon>;
  /** Miles across the map's width, chosen so connections keep their length on average. */
  milesAcross: number | null;
  /** Old connections: what each one becomes. */
  connections: { id: string; kind: "border" | "link"; miles: number | null; terrainId: string }[];
  /** Regions that now touch but weren't connected: new borders, blocked so movement stays as it was. */
  newBlockedBorders: [string, string][];
  /** What the GM should look at, in plain words. */
  report: string[];
}

/** The middle value (the average that ignores the odd outlier). */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function planConversion(input: {
  regions: NodeRegion[];
  connections: NodeConnection[];
  /** Map height ÷ width. */
  aspect: number;
  /** The ruleset's length for connections with no miles of their own. */
  defaultMiles: number;
  terrainName: (id: string) => string;
}): ConversionPlan {
  const { regions, connections, aspect } = input;
  const report: string[] = [];
  const code = new Map(regions.map((r) => [r.id, r.code]));
  const pairName = (a: string, b: string) => `${code.get(a) ?? "?"}–${code.get(b) ?? "?"}`;

  // Outlines: each region without one gets the area nearer its centre than any other's.
  const cells = voronoiCells(
    regions.map((r): Pt => [r.x, r.y]),
    aspect,
  );
  const polygons = new Map<string, Polygon>();
  regions.forEach((r, i) => {
    if (r.polygon.length < 3) polygons.set(r.id, cells[i]);
  });
  if (polygons.size) report.push(`Drew starting shapes for ${polygons.size} region${polygons.size === 1 ? "" : "s"} from their dots. Adjust them in the map editor.`);

  const shapes = regions.map((r) => ({ id: r.id, polygon: polygons.get(r.id) ?? r.polygon }));
  const touching = new Set(adjacentPairs(shapes).map(([a, b]) => `${a}|${b}`));
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const centre = new Map(regions.map((r) => [r.id, [r.x, r.y] as Pt]));

  // Scale: what one map-width is in miles, so connections keep their length (the median one exactly).
  const ratios = connections
    .map((c) => {
      const a = centre.get(c.regionA);
      const b = centre.get(c.regionB);
      const d = a && b ? length(a, b, aspect) : 0;
      return d > 0 ? (c.miles ?? input.defaultMiles) / d : null;
    })
    .filter((x): x is number => x !== null);
  const scale = median(ratios);
  const milesAcross = scale ? Math.round(scale * 10) / 10 : null;
  if (milesAcross) report.push(`Map scale set to ${milesAcross} miles across the map, so connections keep about the same length. Change it in the map editor.`);

  const out: ConversionPlan["connections"] = [];
  const customMiles: string[] = [];
  const borderTerrain: string[] = [];
  const hiddenBorders: string[] = [];
  const links: string[] = [];
  for (const c of connections) {
    const name = pairName(c.regionA, c.regionB);
    if (touching.has(key(c.regionA, c.regionB))) {
      out.push({ id: c.id, kind: "border", miles: null, terrainId: "normal" });
      if (c.miles !== null) customMiles.push(`${name} (${c.miles} mi)`);
      if (c.terrainId !== "normal") borderTerrain.push(`${name} (${input.terrainName(c.terrainId)})`);
      if (c.hidden) hiddenBorders.push(name);
    } else {
      out.push({ id: c.id, kind: "link", miles: c.miles, terrainId: c.terrainId });
      links.push(name);
    }
  }
  if (customMiles.length) report.push(`Distances are now measured on the map, so these connections' own lengths were dropped: ${customMiles.join(", ")}.`);
  if (borderTerrain.length) report.push(`Terrain now comes from terrain areas drawn on the map. Draw areas for these old connections: ${borderTerrain.join(", ")}.`);
  if (hiddenBorders.length) report.push(`These hidden connections are now hidden borders (teams still have to discover them): ${hiddenBorders.join(", ")}.`);
  if (links.length) report.push(`These connections join regions that don't touch, so they're now links (like tunnels or sea lanes): ${links.join(", ")}.`);

  const connected = new Set(connections.map((c) => key(c.regionA, c.regionB)));
  const newBlockedBorders = [...touching].filter((k) => !connected.has(k)).map((k) => k.split("|") as [string, string]);
  if (newBlockedBorders.length) {
    report.push(
      `These regions touch but weren't connected, so their borders start blocked (movement stays as before; unblock them in the map editor): ${newBlockedBorders.map(([a, b]) => pairName(a, b)).join(", ")}.`,
    );
  }

  return { polygons, milesAcross, connections: out, newBlockedBorders, report };
}

/** An old path input (region IDs) as waypoints at those regions' centres. Anything else is left alone. */
export function convertPathInput(value: unknown, centreOf: (regionId: string) => Pt | null): unknown {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return value;
  return value.map((id) => centreOf(id)).filter((p): p is Pt => p !== null);
}

export interface BorderRow {
  id: string;
  regionA: string;
  regionB: string;
  kind: string;
}

/**
 * After shapes change: which regions now touch, and what to change in the
 * connections so borders match. Borders whose regions no longer touch go; new
 * touching pairs get an open border; a link between regions that now touch
 * becomes their border (keeping whether it's hidden or blocked).
 */
export function planBorderSync(shapes: { id: string; polygon: Polygon }[], rows: BorderRow[]) {
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const touching = new Set(adjacentPairs(shapes).map(([a, b]) => key(a, b)));
  const byPair = new Map(rows.map((r) => [key(r.regionA, r.regionB), r]));
  return {
    remove: rows.filter((r) => r.kind === "border" && !touching.has(key(r.regionA, r.regionB))).map((r) => r.id),
    toBorder: rows.filter((r) => r.kind !== "border" && touching.has(key(r.regionA, r.regionB))).map((r) => r.id),
    add: [...touching].filter((k) => !byPair.has(k)).map((k) => k.split("|") as [string, string]),
  };
}
