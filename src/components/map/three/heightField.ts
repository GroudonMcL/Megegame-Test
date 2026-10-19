// The ground of the 3D map. The map lies flat in x (left → right, -0.5…0.5)
// and z (top → bottom, -aspect/2…aspect/2), so it is 1 unit wide; y is up.
// A height field gives the height (0–1) at each point of the map, from the
// height map image (white = highest); relief scales it to world units.

export type Pt = [number, number];
export type Vec3 = [number, number, number];

export interface HeightField {
  /** Samples across and down. */
  cols: number;
  rows: number;
  /** Heights 0–1, row by row from the top of the map. */
  data: Float32Array;
}

/** A field that is flat everywhere (no height map). */
export const FLAT: HeightField = { cols: 1, rows: 1, data: new Float32Array([0]) };

/** Height (0–1) at a point of the map (fractions), smoothly between samples. */
export function sampleHeight(f: HeightField, fx: number, fy: number): number {
  if (f.cols < 2 || f.rows < 2) return f.data[0] ?? 0;
  const x = Math.min(Math.max(fx, 0), 1) * (f.cols - 1);
  const y = Math.min(Math.max(fy, 0), 1) * (f.rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, f.cols - 1);
  const y1 = Math.min(y0 + 1, f.rows - 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (c: number, r: number) => f.data[r * f.cols + c];
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

/** Map point (fractions) → world position on the ground. */
export function toWorld(f: HeightField, relief: number, aspect: number, p: Pt, lift = 0): Vec3 {
  return [p[0] - 0.5, sampleHeight(f, p[0], p[1]) * relief + lift, p[1] * aspect - aspect / 2];
}

/** World x, z → map point (fractions). */
export function toMapPoint(aspect: number, x: number, z: number): Pt {
  return [x + 0.5, (z + aspect / 2) / aspect];
}

/**
 * Where a ray (from the camera through the pointer) first meets the ground,
 * as a map point, or null if it misses the map. Marches along the ray inside
 * the map's box, then narrows down the crossing.
 */
export function intersectGround(f: HeightField, relief: number, aspect: number, origin: Vec3, dir: Vec3): Pt | null {
  const lo: Vec3 = [-0.5, -1e-6, -aspect / 2];
  const hi: Vec3 = [0.5, relief + 1e-6, aspect / 2];
  let t0 = 0;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-12) {
      if (origin[i] < lo[i] || origin[i] > hi[i]) return null;
      continue;
    }
    let a = (lo[i] - origin[i]) / dir[i];
    let b = (hi[i] - origin[i]) / dir[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (t0 > t1 || !Number.isFinite(t1)) return null;
  const at = (t: number): Vec3 => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  const above = (t: number) => {
    const [x, y, z] = at(t);
    const [fx, fy] = toMapPoint(aspect, x, z);
    return y - sampleHeight(f, fx, fy) * relief;
  };
  const steps = relief > 0 ? 256 : 1;
  let prev = t0;
  if (above(prev) <= 0) return toMapPoint(aspect, at(prev)[0], at(prev)[2]);
  for (let i = 1; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    if (above(t) <= 0) {
      let a = prev;
      let b = t;
      for (let k = 0; k < 20; k++) {
        const m = (a + b) / 2;
        if (above(m) > 0) a = m;
        else b = m;
      }
      const hit = at(b);
      return toMapPoint(aspect, hit[0], hit[2]);
    }
    prev = t;
  }
  return null;
}

/** Distance from p to the polyline, in map widths (y scaled by aspect). */
export function distToLine(p: Pt, line: Pt[], aspect: number): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = (by - ay) * aspect;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * aspect * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), (p[1] - ay) * aspect - dy * t));
  }
  return best;
}

/** Points along a line every `step` (map widths), so a line drawn above the ground follows its shape. */
export function densify(line: Pt[], step: number, aspect: number): Pt[] {
  if (line.length < 2) return line;
  const out: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, (by - ay) * aspect) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}
