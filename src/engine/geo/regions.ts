import { bbox, boundaryHits, boxesOverlap, distToBoundary, distToSegment, EPS, lerp, pointInPolygon, segmentHits, type Box, type Polygon, type Pt } from "./polygon";

// Regions as shapes: which region a point is in, which regions a line passes
// through, and which regions are neighbours.

export interface Shape {
  id: string;
  polygon: Polygon;
}

/** Shapes with their bounding boxes worked out once, for repeated lookups. */
export interface ShapeIndex {
  shapes: (Shape & { box: Box })[];
}

export function indexShapes(shapes: Shape[]): ShapeIndex {
  return { shapes: shapes.filter((s) => s.polygon.length >= 3).map((s) => ({ ...s, box: bbox(s.polygon) })) };
}

/**
 * The region a point is in. A point just outside every shape (within eps,
 * e.g. on a border drawn a hair apart) belongs to the nearest one; a point
 * clear of all of them is in no region (null): open ground nobody can enter.
 */
export function regionAt(index: ShapeIndex, p: Pt, eps = EPS): string | null {
  let near: { id: string; d: number } | null = null;
  for (const s of index.shapes) {
    if (p[0] < s.box.minX - eps || p[0] > s.box.maxX + eps || p[1] < s.box.minY - eps || p[1] > s.box.maxY + eps) continue;
    if (pointInPolygon(p, s.polygon)) return s.id;
    const d = distToBoundary(p, s.polygon);
    if (d <= eps && (!near || d < near.d)) near = { id: s.id, d };
  }
  return near?.id ?? null;
}

export interface Stretch {
  /** The region this part of the line is in; null = outside every region. */
  regionId: string | null;
  /** Where it starts and ends along the line (0–1). */
  t0: number;
  t1: number;
}

/**
 * The regions a straight line from a to b passes through, in order. Crossing
 * exactly through a corner where two regions touch goes straight from one to
 * the other.
 */
export function traceSegment(index: ShapeIndex, a: Pt, b: Pt, eps = EPS): Stretch[] {
  const segBox = bbox([a, b]);
  const ts = [0, 1];
  for (const s of index.shapes) if (boxesOverlap(segBox, s.box, eps)) ts.push(...boundaryHits(a, b, s.polygon));
  ts.sort((x, y) => x - y);
  const out: Stretch[] = [];
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i - 1];
    const t1 = ts[i];
    if (t1 - t0 < 1e-9) continue;
    const id = regionAt(index, lerp(a, b, (t0 + t1) / 2), eps);
    const last = out[out.length - 1];
    if (last && last.regionId === id) last.t1 = t1;
    else out.push({ regionId: id, t0: out.length ? last!.t1 : 0, t1 });
  }
  if (!out.length) out.push({ regionId: regionAt(index, a, eps), t0: 0, t1: 1 });
  return out;
}

/** Do the outlines of p and q touch (a shared edge, or just a corner)? */
export function touches(p: Polygon, q: Polygon, eps = EPS): boolean {
  if (!boxesOverlap(bbox(p), bbox(q), eps)) return false;
  for (const v of p) if (distToBoundary(v, q) <= eps) return true;
  for (const v of q) if (distToBoundary(v, p) <= eps) return true;
  // Outlines that cross without a corner on the other (overlapping shapes).
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      if (segmentHits(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length]).length) return true;
    }
  }
  return false;
}

/** Every pair of neighbouring regions, as [smaller id, larger id]. */
export function adjacentPairs(shapes: Shape[], eps = EPS): [string, string][] {
  const index = indexShapes(shapes);
  const out: [string, string][] = [];
  const list = index.shapes;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!boxesOverlap(list[i].box, list[j].box, eps)) continue;
      if (touches(list[i].polygon, list[j].polygon, eps)) out.push(list[i].id < list[j].id ? [list[i].id, list[j].id] : [list[j].id, list[i].id]);
    }
  }
  return out;
}

/** The parts of p's outline that run along q's outline (for drawing a border). */
export function sharedBorder(p: Polygon, q: Polygon, eps = EPS): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const on = (pt: Pt) => q.some((_, j) => distToSegment(pt, q[j], q[(j + 1) % q.length]) <= eps);
    if (on(a) && on(b) && on(lerp(a, b, 0.5))) out.push([a, b]);
  }
  return out;
}
