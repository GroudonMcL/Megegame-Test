import type { Polygon, Pt } from "./polygon";

// Starting shapes for regions that only have a centre point: each region gets
// the part of the map closer to its point than to any other region's point
// (a Voronoi cell). Neighbouring cells share their edges exactly.

/** Keeps the part of a convex polygon on the side of the line where f(p) <= 0. */
function clipHalfPlane(poly: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * One cell per site, inside the rectangle 0–1 × 0–1 (fractions of the map).
 * aspect = map height ÷ width, so "closer" means closer on the real map.
 * Sites at the same spot are nudged apart.
 */
export function voronoiCells(sites: Pt[], aspect: number): Polygon[] {
  const s = sites.map(([x, y], i): Pt => {
    const dup = sites.findIndex(([x2, y2], j) => j < i && Math.abs(x2 - x) < 1e-9 && Math.abs(y2 - y) < 1e-9);
    return dup >= 0 ? [x + 1e-4 * (i % 7), y * aspect + 1e-4 * ((i + 3) % 5)] : [x, y * aspect];
  });
  return s.map((p, i) => {
    let cell: Pt[] = [
      [0, 0],
      [1, 0],
      [1, aspect],
      [0, aspect],
    ];
    for (let j = 0; j < s.length && cell.length; j++) {
      if (j === i) continue;
      const q = s[j];
      // Closer to p than to q: (x - m) · (q - p) <= 0, m = midpoint.
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      cell = clipHalfPlane(cell, ([x, y]) => (x - mx) * dx + (y - my) * dy);
    }
    return cell.map(([x, y]): Pt => [x, y / aspect]);
  });
}
