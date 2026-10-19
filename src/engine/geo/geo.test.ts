import { describe, expect, it } from "vitest";
import { clipToAreas } from "./clip";
import { area, cleanPolygon, fractionInside, length, pointInPolygon, type Polygon } from "./polygon";
import { adjacentPairs, indexShapes, regionAt, sharedBorder, traceSegment } from "./regions";
import { voronoiCells } from "./voronoi";

const square = (x: number, y: number, s = 0.5): Polygon => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

// A 2×2 board: A B / C D. A and D touch only at the centre corner.
const board = [
  { id: "A", polygon: square(0, 0) },
  { id: "B", polygon: square(0.5, 0) },
  { id: "C", polygon: square(0, 0.5) },
  { id: "D", polygon: square(0.5, 0.5) },
];

describe("polygons", () => {
  it("knows inside from outside", () => {
    expect(pointInPolygon([0.25, 0.25], square(0, 0))).toBe(true);
    expect(pointInPolygon([0.75, 0.25], square(0, 0))).toBe(false);
  });

  it("measures area and length with the map's aspect ratio", () => {
    expect(area(square(0, 0), 1)).toBeCloseTo(0.25);
    expect(length([0, 0], [0, 0.5], 2)).toBeCloseTo(1);
  });

  it("measures how much of a line is inside a shape", () => {
    expect(fractionInside([-0.5, 0.25], [1, 0.25], square(0, 0))).toBeCloseTo(1 / 3);
    expect(fractionInside([0.1, 0.1], [0.2, 0.2], square(0, 0))).toBeCloseTo(1);
  });

  it("cleans up stored outlines", () => {
    expect(cleanPolygon([[0, 0], [1, 0], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1]]);
    expect(cleanPolygon([[0, 0], [1, 1]])).toBeNull();
    expect(cleanPolygon("nope")).toBeNull();
  });
});

describe("regions", () => {
  const index = indexShapes(board);

  it("finds the region at a point, and none outside the map", () => {
    expect(regionAt(index, [0.2, 0.7])).toBe("C");
    expect(regionAt(index, [1.2, 0.2])).toBeNull();
    // A hair outside a border still counts as the nearest region.
    expect(regionAt(index, [1.00005, 0.2])).toBe("B");
  });

  it("traces the regions a line passes through", () => {
    const route = traceSegment(index, [0.25, 0.25], [0.75, 0.25]);
    expect(route.map((s) => s.regionId)).toEqual(["A", "B"]);
    expect(route[0].t1).toBeCloseTo(0.5);
  });

  it("goes straight through a corner", () => {
    expect(traceSegment(index, [0.25, 0.25], [0.75, 0.75]).map((s) => s.regionId)).toEqual(["A", "D"]);
  });

  it("notices open ground outside every region", () => {
    expect(traceSegment(index, [0.75, 0.25], [1.25, 0.25]).map((s) => s.regionId)).toEqual(["B", null]);
  });

  it("treats shared edges and shared corners as neighbours", () => {
    const pairs = adjacentPairs(board).map((p) => p.join(""));
    expect(pairs.sort()).toEqual(["AB", "AC", "AD", "BC", "BD", "CD"]);
  });

  it("doesn't join regions that are apart", () => {
    expect(adjacentPairs([board[0], { id: "Z", polygon: square(0.6, 0.6, 0.2) }])).toEqual([]);
  });

  it("finds the border two regions share", () => {
    expect(sharedBorder(board[0].polygon, board[1].polygon)).toEqual([[[0.5, 0], [0.5, 0.5]]]);
    expect(sharedBorder(board[0].polygon, board[3].polygon)).toEqual([]);
  });
});

describe("voronoi cells", () => {
  it("splits the map between the points, sharing edges", () => {
    const cells = voronoiCells(
      [
        [0.25, 0.5],
        [0.75, 0.5],
      ],
      1,
    );
    expect(cells).toHaveLength(2);
    expect(area(cells[0])).toBeCloseTo(0.5);
    expect(pointInPolygon([0.1, 0.5], cells[0])).toBe(true);
    expect(adjacentPairs(cells.map((polygon, i) => ({ id: String(i), polygon })))).toEqual([["0", "1"]]);
  });

  it("covers the whole map", () => {
    const sites = Array.from({ length: 30 }, (_, i): [number, number] => [((i * 37) % 100) / 100, ((i * 61) % 100) / 100]);
    const cells = voronoiCells(sites, 0.7);
    expect(cells.reduce((s, c) => s + area(c), 0)).toBeCloseTo(1, 6);
    cells.forEach((c, i) => expect(pointInPolygon(sites[i], c)).toBe(true));
  });
});

describe("clipping", () => {
  it("keeps only the part inside the masks, holes included", () => {
    const pieces = clipToAreas(square(0.25, 0.25), [board[0].polygon]);
    expect(pieces).toHaveLength(1);
    expect(area(pieces[0][0])).toBeCloseTo(0.0625);
    expect(clipToAreas(square(0, 0), [])).toEqual([]);
  });

  it("keeps a hole where an unknown region sits inside known ones", () => {
    // A 3×3 grid of thirds with the middle one unknown.
    const known: Polygon[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== 1 || j !== 1) known.push(square(i / 3, j / 3, 1 / 3));
    const pieces = clipToAreas(square(0, 0, 1), known);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toHaveLength(2);
    expect(area(pieces[0][0]) - area(pieces[0][1])).toBeCloseTo(8 / 9);
  });
});
