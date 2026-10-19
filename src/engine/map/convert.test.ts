import { describe, expect, it } from "vitest";
import { convertPathInput, planBorderSync, planConversion, type NodeConnection, type NodeRegion } from "./convert";

// Three dots in a row and one below the middle: A – B – C, with D under B.
const regions: NodeRegion[] = [
  { id: "a", code: "A", x: 0.2, y: 0.3, polygon: [] },
  { id: "b", code: "B", x: 0.5, y: 0.3, polygon: [] },
  { id: "c", code: "C", x: 0.8, y: 0.3, polygon: [] },
  { id: "d", code: "D", x: 0.5, y: 0.8, polygon: [] },
];
const conn = (id: string, a: string, b: string, extra: Partial<NodeConnection> = {}): NodeConnection => ({ id, regionA: a, regionB: b, miles: null, terrainId: "normal", hidden: false, ...extra });

describe("converting a node map", () => {
  const plan = planConversion({
    regions,
    connections: [conn("ab", "a", "b"), conn("bc", "b", "c", { miles: 20, terrainId: "difficult" }), conn("ac", "a", "c", { hidden: true })],
    aspect: 1,
    defaultMiles: 12,
    terrainName: (id) => (id === "difficult" ? "Difficult" : id),
  });

  it("gives every region a shape", () => {
    expect(plan.polygons.size).toBe(4);
  });

  it("keeps connections between touching regions as borders, and the rest as links", () => {
    expect(plan.connections.find((c) => c.id === "ab")?.kind).toBe("border");
    expect(plan.connections.find((c) => c.id === "bc")).toEqual({ id: "bc", kind: "border", miles: null, terrainId: "normal" });
    expect(plan.connections.find((c) => c.id === "ac")?.kind).toBe("link");
  });

  it("blocks borders that weren't connections before", () => {
    const pairs = plan.newBlockedBorders.map((p) => p.sort().join(""));
    expect(pairs).toContain("bd");
    expect(pairs).not.toContain("ab");
  });

  it("sets the scale from the connections' lengths", () => {
    // A–B is 0.3 map widths and 12 miles; B–C 0.3 and 20; A–C 0.6 and 12. Median of 40, 66.7, 20 = 40.
    expect(plan.milesAcross).toBeCloseTo(40);
  });

  it("reports what needs a person", () => {
    const text = plan.report.join("\n");
    expect(text).toContain("B–C (20 mi)");
    expect(text).toContain("B–C (Difficult)");
    expect(text).toContain("A–C");
    expect(text).toMatch(/blocked/);
  });

  it("keeps outlines that already exist", () => {
    const drawn = planConversion({
      regions: [{ ...regions[0], polygon: [[0, 0], [0.4, 0], [0.4, 0.4]] }, regions[1]],
      connections: [],
      aspect: 1,
      defaultMiles: 12,
      terrainName: (id) => id,
    });
    expect(drawn.polygons.has("a")).toBe(false);
    expect(drawn.polygons.has("b")).toBe(true);
    expect(drawn.milesAcross).toBeNull();
  });
});

describe("converting a path", () => {
  it("turns region IDs into their centres", () => {
    const centre = (id: string) => (id === "b" ? ([0.5, 0.3] as [number, number]) : null);
    expect(convertPathInput(["b", "gone"], centre)).toEqual([[0.5, 0.3]]);
    expect(convertPathInput([[0.1, 0.2]], centre)).toEqual([[0.1, 0.2]]);
  });
});

describe("keeping borders in step with shapes", () => {
  const sq = (x: number): [number, number][] => [
    [x, 0],
    [x + 0.25, 0],
    [x + 0.25, 0.25],
    [x, 0.25],
  ];
  it("adds, removes and promotes", () => {
    // A and B touch; C stands apart.
    const shapes = [
      { id: "a", polygon: sq(0) },
      { id: "b", polygon: sq(0.25) },
      { id: "c", polygon: sq(0.75) },
    ];
    const plan = planBorderSync(shapes, [
      { id: "old", regionA: "a", regionB: "c", kind: "border" },
      { id: "tunnel", regionA: "b", regionB: "c", kind: "link" },
    ]);
    expect(plan.remove).toEqual(["old"]);
    expect(plan.toBorder).toEqual([]);
    expect(plan.add).toEqual([["a", "b"]]);
    const promoted = planBorderSync(shapes, [{ id: "l", regionA: "b", regionB: "a", kind: "link" }]);
    expect(promoted).toEqual({ remove: [], toBorder: ["l"], add: [] });
  });
});
