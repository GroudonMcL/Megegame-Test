import { describe, expect, it } from "vitest";
import type { Polygon, Pt } from "../geo/polygon";
import { indexShapes } from "../geo/regions";
import type { WorldConnection, WorldUnit } from "../world/types";
import { buildPreset } from "@/presets";
import { parsePath, traceRoute, type RouteMap, type TerrainShape } from "./route";

// A 2×2 board of squares, half the map wide each: A B / C D. The map is 40
// miles across, so walking from one centre to the next is 20 miles. A 30 ft
// unit has 24 miles a round (Utterdark: 24 miles a day, one travel day).
const rules = buildPreset("utterdark");
const sq = (x: number, y: number): Polygon => [
  [x, y],
  [x + 0.5, y],
  [x + 0.5, y + 0.5],
  [x, y + 0.5],
];
const shapes = [
  { id: "A", polygon: sq(0, 0) },
  { id: "B", polygon: sq(0.5, 0) },
  { id: "C", polygon: sq(0, 0.5) },
  { id: "D", polygon: sq(0.5, 0.5) },
];
const centres: Record<string, Pt> = { A: [0.25, 0.25], B: [0.75, 0.25], C: [0.25, 0.75], D: [0.75, 0.75] };
const conn = (a: string, b: string, extra: Partial<WorldConnection> = {}): WorldConnection => ({
  id: `${a}${b}`,
  regionA: a,
  regionB: b,
  kind: "border",
  blocked: false,
  miles: null,
  terrainId: "normal",
  hidden: false,
  ...extra,
});
const allBorders = [conn("A", "B"), conn("A", "C"), conn("A", "D"), conn("B", "D"), conn("C", "D"), conn("B", "C")];

function map(extra: Partial<RouteMap> = {}): RouteMap {
  return {
    index: indexShapes(shapes),
    centre: (id) => centres[id] ?? null,
    label: (id) => id,
    connections: allBorders,
    terrain: [],
    scale: { aspect: 1, milesAcross: 40 },
    partial: false,
    ...extra,
  };
}
const unit = (creatureId = "guard"): WorldUnit => ({
  id: "u",
  ownerTeamId: "t",
  creatureId,
  name: "Bob",
  raceId: null,
  archetypeId: null,
  academyBonus: {},
  augmentIds: [],
  hp: 10,
  regionId: "A",
  x: null,
  y: null,
  milesUsed: 0,
  status: "active",
  isLeader: false,
  usesSpent: {},
});
const group = (used = 0) => [{ unit: unit(), used }];

describe("routes", () => {
  it("measures a move and reports the regions it enters", () => {
    const res = traceRoute(rules, map(), centres.A, "A", [centres.B], group(), "normal");
    expect(res.blocked).toBeUndefined();
    expect(res.miles[0]).toBeCloseTo(20);
    expect(res.used[0]).toBeCloseTo(20 / 24);
    expect(res.entered.map((e) => e.regionId)).toEqual(["B"]);
    expect(res.entered[0].at[0]).toBeGreaterThan(0.5);
    expect(res.endRegion).toBe("B");
    expect(res.walked).toEqual([centres.A, centres.B]);
  });

  it("can bend through several points", () => {
    const res = traceRoute(rules, map(), centres.A, "A", [[0.4, 0.4], [0.6, 0.4]], group(), "normal");
    expect(res.endRegion).toBe("B");
    expect(res.walked).toHaveLength(3);
  });

  it("stops at a blocked border", () => {
    const res = traceRoute(rules, map({ connections: [conn("A", "B", { blocked: true })] }), centres.A, "A", [centres.B], group(), "normal");
    expect(res.blocked).toMatch(/blocked/);
    expect(res.endRegion).toBe("A");
    expect(res.end[0]).toBeCloseTo(0.5);
  });

  it("needs a border to cross at all", () => {
    expect(traceRoute(rules, map({ connections: [] }), centres.A, "A", [centres.B], group(), "normal").blocked).toMatch(/no way/);
  });

  it("on a team's view, goes on between regions whose borders it doesn't know", () => {
    // Only A is seen; B and D are unexplored, and nobody has told the team about B—D.
    const fogged = map({ partial: true, connections: [conn("A", "B")], knowsBorders: (id) => id === "A", scale: { aspect: 1, milesAcross: 20 } });
    const r = traceRoute(rules, fogged, centres.A, "A", [centres.B, centres.D], group(), "normal");
    expect(r.blocked).toBeUndefined();
    expect(r.unknown).toBe(true);
    expect(r.entered.map((e) => e.regionId)).toEqual(["B", "D"]);
    // Between two regions it can see, a missing border is real.
    const seen = map({ partial: true, connections: [conn("A", "B")], knowsBorders: () => true });
    expect(traceRoute(rules, seen, centres.B, "B", [centres.D], group(), "normal").blocked).toMatch(/no way/);
    // A border it knows is blocked still stops it.
    const shut = map({ partial: true, connections: [conn("A", "B"), conn("B", "D", { blocked: true })], knowsBorders: (id) => id === "A" });
    expect(traceRoute(rules, shut, centres.B, "B", [centres.D], group(), "normal").blocked).toMatch(/blocked/);
  });

  it("crosses through a corner where regions only touch at a point", () => {
    const res = traceRoute(rules, map(), centres.A, "A", [centres.D], group(), "normal");
    expect(res.entered.map((e) => e.regionId)).toEqual(["D"]);
  });

  it("stops part-way when movement runs out", () => {
    const res = traceRoute(rules, map(), centres.A, "A", [centres.B], group(0.5), "normal");
    expect(res.outOfMovement).toBe(true);
    expect(res.used[0]).toBeCloseTo(1);
    // Half of 24 miles = 12 of the 20: 60% of the way.
    expect(res.end[0]).toBeCloseTo(0.25 + 0.5 * 0.6);
  });

  it("lets a force march go twice as far", () => {
    const res = traceRoute(rules, map(), centres.A, "A", [centres.B], group(0.5), "forceMarch");
    expect(res.outOfMovement).toBeUndefined();
    expect(res.endRegion).toBe("B");
  });

  it("charges double for the part inside difficult terrain", () => {
    const forest: TerrainShape = { terrainId: "difficult", rings: [sq(0.5, 0)] };
    const res = traceRoute(rules, map({ terrain: [forest] }), centres.A, "A", [[0.6, 0.25]], group(), "normal");
    // 0.25 of plain (10 mi) + 0.1 of forest (4 mi × 2).
    expect(res.miles[0]).toBeCloseTo(18);
  });

  it("won't wade into water without a swim or fly speed", () => {
    const lake: TerrainShape = { terrainId: "water", rings: [sq(0.5, 0)] };
    const res = traceRoute(rules, map({ terrain: [lake] }), centres.A, "A", [centres.B], group(), "normal");
    expect(res.blocked).toMatch(/Flooded/);
    expect(res.end[0]).toBeCloseTo(0.5);
  });

  it("treats ground outside every region as open ground on the real map, and as unknown on a team's", () => {
    const real = traceRoute(rules, map(), centres.B, "B", [[1.2, 0.25]], group(), "normal");
    expect(real.blocked).toMatch(/open ground/);
    const team = traceRoute(rules, map({ partial: true }), centres.B, "B", [[1.2, 0.25]], group(), "normal");
    expect(team.blocked).toBeUndefined();
    expect(team.unknown).toBe(true);
    expect(team.endRegion).toBeNull();
  });

  it("lets the rules stop the move on entering a region", () => {
    const res = traceRoute(rules, map(), centres.A, "A", [centres.B, centres.D], group(), "normal", (id) => id === "B");
    expect(res.endRegion).toBe("B");
    expect(res.end[0]).toBeGreaterThan(0.5);
    expect(res.end[0]).toBeLessThan(0.52);
  });

  it("takes a link to the region at its other end", () => {
    const tunnel = conn("A", "D", { id: "tunnel", kind: "link", miles: 6 });
    const res = traceRoute(rules, map({ connections: [tunnel] }), centres.A, "A", [{ link: "tunnel" }], group(), "normal");
    expect(res.endRegion).toBe("D");
    expect(res.end).toEqual(centres.D);
    expect(res.miles[0]).toBeCloseTo(6);
  });

  it("reads stored paths, dropping anything odd", () => {
    expect(parsePath([[0.1, 0.2], { link: "x" }, "B2", [1], null])).toEqual([[0.1, 0.2], { link: "x" }]);
    expect(parsePath("nope")).toEqual([]);
  });
});
