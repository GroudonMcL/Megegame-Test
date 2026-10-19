import { distToSegment, EPS, pointInPolygon, signedArea2, type Polygon, type Pt } from "./polygon";

// Editing shapes in the map editor. Shapes are kept as separate outlines, but
// corners at the same spot (within EPS) count as one shared corner: dragging
// it moves it in every shape, and adding a corner on a shared edge adds it to
// both shapes, so neighbours stay joined.

export type ShapeMap = Record<string, Polygon>;

const same = (a: Pt, b: Pt, eps = EPS) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

/** Where a point snapped to: a corner, a spot on an edge, or nowhere (a free point). */
export type Snap = { p: Pt; kind: "free" } | { p: Pt; kind: "corner"; shape: string; index: number } | { p: Pt; kind: "edge"; shape: string; edge: number; t: number };

/**
 * Snaps p to the nearest corner within tol, else the nearest edge within tol,
 * else leaves it. aspect = height ÷ width, so tol is the same distance either way.
 */
export function snapPoint(p: Pt, shapes: ShapeMap, tol: number, aspect = 1, skip?: string): Snap {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * aspect);
  let corner: Extract<Snap, { kind: "corner" }> | null = null;
  let best = tol;
  for (const [id, poly] of Object.entries(shapes)) {
    if (id === skip) continue;
    poly.forEach((v, i) => {
      const dist = d(p, v);
      if (dist <= best) {
        best = dist;
        corner = { p: v, kind: "corner", shape: id, index: i };
      }
    });
  }
  if (corner) return corner;
  let edge: Extract<Snap, { kind: "edge" }> | null = null;
  best = tol;
  for (const [id, poly] of Object.entries(shapes)) {
    if (id === skip) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0];
      const dy = (b[1] - a[1]) * aspect;
      const len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * aspect * dy) / len2));
      const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const dist = d(p, q);
      if (dist <= best) {
        best = dist;
        edge = { p: q, kind: "edge", shape: id, edge: i, t };
      }
    }
  }
  return edge ?? { p, kind: "free" };
}

/** Every corner at this spot, in any shape. */
export function cornersAt(shapes: ShapeMap, p: Pt, eps = EPS): { shape: string; index: number }[] {
  const out: { shape: string; index: number }[] = [];
  for (const [id, poly] of Object.entries(shapes)) poly.forEach((v, i) => same(v, p, eps) && out.push({ shape: id, index: i }));
  return out;
}

/** Moves the corner at `from` to `to` in every shape that has it. */
export function moveCorner(shapes: ShapeMap, from: Pt, to: Pt): ShapeMap {
  const out: ShapeMap = {};
  for (const [id, poly] of Object.entries(shapes)) out[id] = poly.some((v) => same(v, from)) ? poly.map((v) => (same(v, from) ? to : v)) : poly;
  return out;
}

/** Adds a corner at p on the edge a–b, in every shape that has that edge (either way round). */
export function insertCorner(shapes: ShapeMap, a: Pt, b: Pt, p: Pt): ShapeMap {
  const out: ShapeMap = {};
  for (const [id, poly] of Object.entries(shapes)) {
    const next: Polygon = [];
    poly.forEach((v, i) => {
      next.push(v);
      const w = poly[(i + 1) % poly.length];
      if ((same(v, a) && same(w, b)) || (same(v, b) && same(w, a))) next.push(p);
    });
    out[id] = next;
  }
  return out;
}

/** Removes the corner at p from every shape that has it, unless that would leave a shape with fewer than 3 corners. */
export function removeCorner(shapes: ShapeMap, p: Pt): ShapeMap | null {
  const out: ShapeMap = {};
  for (const [id, poly] of Object.entries(shapes)) {
    const next = poly.filter((v) => !same(v, p));
    if (next.length !== poly.length && next.length < 3) return null;
    out[id] = next;
  }
  return out;
}

/**
 * Adds the corner a snapped point landed on to the shape it landed on (when it
 * landed mid-edge), so a new shape drawn against a neighbour shares the corner.
 */
export function addSnapCorner(shapes: ShapeMap, s: Snap): ShapeMap {
  if (s.kind !== "edge") return shapes;
  const poly = shapes[s.shape];
  const a = poly[s.edge];
  const b = poly[(s.edge + 1) % poly.length];
  if (same(s.p, a) || same(s.p, b)) return shapes;
  return insertCorner(shapes, a, b, s.p);
}

/** A point's place along a shape's outline: edge index plus how far along it (0–1). */
function placeOn(poly: Polygon, p: Pt): number | null {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (distToSegment(p, a, b) > EPS) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return i + (len ? Math.hypot(p[0] - a[0], p[1] - a[1]) / len : 0);
  }
  return null;
}

/**
 * The corners of `poly` between points p and q (both on its outline), going
 * the shorter way round, so a new edge from p to q can follow the neighbour's
 * border instead of cutting across it. Empty if they're not both on it.
 */
export function traceBetween(poly: Polygon, p: Pt, q: Pt): Pt[] {
  const a = placeOn(poly, p);
  const b = placeOn(poly, q);
  if (a === null || b === null) return [];
  const n = poly.length;
  // Distance round the outline (in edges) from a forward to b, and back.
  const fwdEnd = (b - a + n) % n;
  const backEnd = (a - b + n) % n;
  const forward = poly
    .map((v, k) => ({ v, d: (k - a + n) % n }))
    .filter((x) => x.d > 1e-9 && x.d < fwdEnd - 1e-9)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.v);
  const backward = poly
    .map((v, k) => ({ v, d: (a - k + n) % n }))
    .filter((x) => x.d > 1e-9 && x.d < backEnd - 1e-9)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.v);
  const len = (pts: Pt[]) => [p, ...pts, q].reduce((s, v, i, arr) => (i ? s + Math.hypot(v[0] - arr[i - 1][0], v[1] - arr[i - 1][1]) : 0), 0);
  return len(forward) <= len(backward) ? forward : backward;
}

/** A good spot for a region's name: its centroid, or a point inside if the centroid falls outside (odd shapes). */
export function labelPoint(poly: Polygon): Pt {
  const a2 = signedArea2(poly);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  const c: Pt = a2 ? [cx / (3 * a2), cy / (3 * a2)] : poly[0];
  if (pointInPolygon(c, poly)) return c;
  // Otherwise the middle of the widest stretch of the shape across the centroid's height.
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 > c[1] !== y2 > c[1]) xs.push(x1 + ((c[1] - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((p, q) => p - q);
  let best: Pt = poly[0];
  let width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) {
      width = xs[i + 1] - xs[i];
      best = [(xs[i] + xs[i + 1]) / 2, c[1]];
    }
  }
  return best;
}
