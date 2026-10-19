import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import type { Polygon, Pt } from "./polygon";

// Cutting shapes against each other, using the polygon-clipping library:
// a team gets terrain areas only where they overlap regions it knows.

/** One piece of a clipped shape: its outline first, then any holes. Draw with the even-odd rule. */
export type Piece = Polygon[];

/** The parts of `area` that lie inside any of `masks`. Holes are kept, so nothing outside the masks leaks through. */
export function clipToAreas(area: Polygon, masks: Polygon[]): Piece[] {
  const valid = masks.filter((m) => m.length >= 3);
  if (area.length < 3 || !valid.length) return [];
  const closed = (p: Polygon): Pt[] => [...p, p[0]];
  let result: MultiPolygon;
  try {
    const [first, ...rest] = valid.map((m) => [closed(m)] as [Pt[]]);
    result = polygonClipping.intersection([closed(area)], polygonClipping.union(first, ...rest));
  } catch {
    return [];
  }
  // Rings repeat their first point at the end; drop it.
  return result.map((piece) => piece.map((ring) => ring.slice(0, -1) as Polygon).filter((r) => r.length >= 3)).filter((p) => p.length > 0);
}

/** SVG path data for pieces (fractions scaled to the map's pixels). */
export function piecesToPath(pieces: Piece[], width: number, height: number): string {
  return pieces
    .flat()
    .map((ring) => `M${ring.map(([x, y]) => `${(x * width).toFixed(1)} ${(y * height).toFixed(1)}`).join("L")}Z`)
    .join("");
}

/** What's left of `area` after cutting away `masks`: its largest piece's outline, or null if nothing is left. */
export function subtractAreas(area: Polygon, masks: Polygon[]): Polygon | null {
  const valid = masks.filter((m) => m.length >= 3);
  const closed = (p: Polygon): Pt[] => [...p, p[0]];
  if (area.length < 3) return null;
  if (!valid.length) return area;
  let result: MultiPolygon;
  try {
    result = polygonClipping.difference([closed(area)], ...valid.map((m) => [closed(m)] as [Pt[]]));
  } catch {
    return null;
  }
  const rings = result.map((piece) => piece[0].slice(0, -1) as Polygon).filter((r) => r.length >= 3);
  if (!rings.length) return null;
  const size = (r: Polygon) => Math.abs(r.reduce((s, [x1, y1], i) => s + x1 * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y1, 0));
  return rings.sort((a, b) => size(b) - size(a))[0];
}
