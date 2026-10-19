import { describe, expect, it } from "vitest";
import { addSnapCorner, insertCorner, labelPoint, moveCorner, removeCorner, snapPoint, traceBetween, type ShapeMap } from "./edit";
import { pointInPolygon } from "./polygon";
import { adjacentPairs } from "./regions";

// Two squares side by side sharing the edge x = 0.5.
const shapes = (): ShapeMap => ({
  A: [
    [0, 0],
    [0.5, 0],
    [0.5, 0.5],
    [0, 0.5],
  ],
  B: [
    [0.5, 0],
    [1, 0],
    [1, 0.5],
    [0.5, 0.5],
  ],
});

describe("snapping", () => {
  it("prefers a corner, then an edge, else leaves the point", () => {
    expect(snapPoint([0.51, 0.01], shapes(), 0.03)).toMatchObject({ kind: "corner", p: [0.5, 0] });
    expect(snapPoint([0.52, 0.25], shapes(), 0.03)).toMatchObject({ kind: "edge", p: [0.5, 0.25] });
    expect(snapPoint([0.75, 0.25], shapes(), 0.03)).toEqual({ kind: "free", p: [0.75, 0.25] });
  });
});

describe("shared corners", () => {
  it("moves a shared corner in every shape", () => {
    const moved = moveCorner(shapes(), [0.5, 0.5], [0.6, 0.55]);
    expect(moved.A[2]).toEqual([0.6, 0.55]);
    expect(moved.B[3]).toEqual([0.6, 0.55]);
    expect(adjacentPairs(Object.entries(moved).map(([id, polygon]) => ({ id, polygon })))).toEqual([["A", "B"]]);
  });

  it("adds a corner on a shared edge to both shapes", () => {
    const out = insertCorner(shapes(), [0.5, 0], [0.5, 0.5], [0.5, 0.25]);
    expect(out.A).toHaveLength(5);
    expect(out.B).toHaveLength(5);
    expect(out.A[2]).toEqual([0.5, 0.25]);
  });

  it("removes a corner everywhere, but not below a triangle", () => {
    const five = insertCorner(shapes(), [0.5, 0], [0.5, 0.5], [0.5, 0.25]);
    expect(removeCorner(five, [0.5, 0.25])?.A).toHaveLength(4);
    const tri: ShapeMap = { T: [[0, 0], [1, 0], [0, 1]] };
    expect(removeCorner(tri, [0, 0])).toBeNull();
  });

  it("adds the corner a drawn point snapped onto mid-edge", () => {
    const snap = snapPoint([0.51, 0.3], shapes(), 0.03, 1);
    expect(addSnapCorner(shapes(), snap).A).toHaveLength(5);
  });
});

describe("following a neighbour's border", () => {
  it("returns the corners between two points, the short way round", () => {
    const poly = shapes().B;
    // From the middle of B's top edge to the middle of its right edge: past (1, 0).
    expect(traceBetween(poly, [0.75, 0], [1, 0.25])).toEqual([[1, 0]]);
    // Along the shared edge: no corners between.
    expect(traceBetween(poly, [0.5, 0.1], [0.5, 0.4])).toEqual([]);
    expect(traceBetween(poly, [0.7, 0.2], [1, 0.25])).toEqual([]);
  });
});

describe("label point", () => {
  it("is the centroid of a plain shape, and inside an odd one", () => {
    expect(labelPoint(shapes().A)).toEqual([0.25, 0.25]);
    const u: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0.8, 1],
      [0.8, 0.2],
      [0.2, 0.2],
      [0.2, 1],
      [0, 1],
    ];
    expect(pointInPolygon(labelPoint(u), u)).toBe(true);
  });
});
