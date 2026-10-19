// Plane geometry for the region map. Points are [x, y]; region shapes are
// stored as fractions of the map image's width and height (0–1), like the old
// node positions. Containment, crossings and adjacency don't change when the
// map is stretched, so they work on fractions directly; anything measured
// (lengths, Voronoi cells) scales y by the map's aspect ratio first.

export type Pt = [number, number];
export type Polygon = Pt[];

/** Points closer than this (as a fraction of the map) count as touching. */
export const EPS = 1e-4;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(pts: Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY;
}

/** Twice the signed area (positive = counter-clockwise in y-up terms). */
export function signedArea2(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

export function area(poly: Polygon, aspect = 1): number {
  return (Math.abs(signedArea2(poly)) / 2) * aspect;
}

/** Even-odd ray casting. Points exactly on the edge may go either way; use onBoundary for that. */
export function pointInPolygon([px, py]: Pt, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p to the segment a–b. */
export function distToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from p to the polygon's outline. */
export function distToBoundary(p: Pt, poly: Polygon): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

export function onBoundary(p: Pt, poly: Polygon, eps = EPS): boolean {
  return distToBoundary(p, poly) <= eps;
}

/**
 * Where segment a–b crosses segment c–d, as the parameter t along a–b (0–1),
 * or null if they don't meet. Overlapping collinear segments give both ends of the overlap.
 */
export function segmentHits(a: Pt, b: Pt, c: Pt, d: Pt): number[] {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const len2 = rx * rx + ry * ry;
  if (Math.abs(denom) < 1e-15) {
    // Parallel: only collinear overlaps count.
    if (Math.abs(qpx * ry - qpy * rx) > 1e-12 || len2 === 0) return [];
    const t0 = (qpx * rx + qpy * ry) / len2;
    const t1 = ((d[0] - a[0]) * rx + (d[1] - a[1]) * ry) / len2;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    return lo <= hi ? [lo, hi] : [];
  }
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  const tol = 1e-12;
  return t >= -tol && t <= 1 + tol && u >= -tol && u <= 1 + tol ? [Math.max(0, Math.min(1, t))] : [];
}

/** Every t (0–1) at which segment a–b meets the polygon's outline. */
export function boundaryHits(a: Pt, b: Pt, poly: Polygon): number[] {
  const out: number[] = [];
  for (let i = 0; i < poly.length; i++) out.push(...segmentHits(a, b, poly[i], poly[(i + 1) % poly.length]));
  return out;
}

/** The share (0–1) of segment a–b that lies inside the polygon. */
export function fractionInside(a: Pt, b: Pt, poly: Polygon): number {
  const ts = [0, 1, ...boundaryHits(a, b, poly)].sort((x, y) => x - y);
  let inside = 0;
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1];
    const t1 = ts[i];
    if (t1 - t0 < 1e-12) continue;
    const m = (t0 + t1) / 2;
    if (pointInPolygon([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m], poly)) inside += t1 - t0;
  }
  return inside;
}

/** Length of a–b in map widths, given the map's height ÷ width. */
export function length(a: Pt, b: Pt, aspect: number): number {
  return Math.hypot(b[0] - a[0], (b[1] - a[1]) * aspect);
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** A cleaned-up polygon: no repeated points, at least 3 corners, or null. */
export function cleanPolygon(raw: unknown): Polygon | null {
  if (!Array.isArray(raw)) return null;
  const pts: Polygon = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    const q: Pt = [p[0], p[1]];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-9) pts.push(q);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
  return pts.length >= 3 && Math.abs(signedArea2(pts)) > 1e-12 ? pts : null;
}
