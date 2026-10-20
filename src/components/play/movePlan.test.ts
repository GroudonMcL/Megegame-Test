import { describe, expect, it } from "vitest";
import { routeMapFromView } from "@/engine/orders/routeMap";
import { validateOrders } from "@/engine/orders/validate";
import { buildTeamView } from "@/engine/world/teamView";
import type { WorldConnection, WorldRegion, WorldUnit } from "@/engine/world/types";
import { buildPreset } from "@/presets";
import { findJoin, joinOrder, moveActionsFor, moveStart, newOrder, orderUnits, previewMove, withPath } from "./movePlan";

const rules = buildPreset("utterdark");
const ME = "team-me";

// Three square regions in a row, a quarter of the map wide; the map is 48
// miles across, so centre to centre is 12 miles. a—b are joined, b—c blocked.
const cell = (col: number): Pick<WorldRegion, "x" | "y" | "polygon"> => ({
  x: (col + 0.5) / 4,
  y: 0.125,
  polygon: [
    [col / 4, 0],
    [(col + 1) / 4, 0],
    [(col + 1) / 4, 0.25],
    [col / 4, 0.25],
  ],
});
const region = (id: string, col: number): WorldRegion => ({
  id,
  code: id.toUpperCase(),
  name: "",
  description: "",
  ...cell(col),
  settleable: true,
  hidden: false,
  ownerTeamId: id === "a" ? ME : null,
  settlementTierId: id === "a" ? "outpost" : null,
  buildings: [],
  structures: [],
  deposits: [],
  features: [],
});
const conn = (a: string, b: string, blocked = false): WorldConnection => ({ id: `${a}-${b}`, regionA: a, regionB: b, kind: "border", blocked, miles: null, terrainId: "normal", hidden: false });
const unit = (id: string): WorldUnit => ({
  id,
  ownerTeamId: ME,
  creatureId: "guard",
  name: "",
  raceId: null,
  archetypeId: null,
  academyBonus: {},
  augmentIds: [],
  hp: 10,
  regionId: "a",
  x: null,
  y: null,
  milesUsed: 0,
  status: "active",
  isLeader: false,
  usesSpent: {},
});
const g1 = unit("10000000-0000-4000-8000-000000000001");
const g2 = unit("10000000-0000-4000-8000-000000000002");
const view = buildTeamView({
  ruleset: rules,
  regions: [region("a", 0), region("b", 1), region("c", 2)],
  connections: [conn("a", "b"), conn("b", "c", true)],
  units: [g1, g2],
  teams: [{ id: ME, name: "Me", colour: "#000", isNpc: false }],
  team: { id: ME, name: "Me", colour: "#000", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [], secretObjectives: "" },
  knowledge: { regions: new Map(), connections: new Set(), detectedUnits: new Set() },
  terrain: [],
  map: { aspect: 1, milesAcross: 48 },
  inventory: {},
  round: 1,
});
const move = rules.actionTypes.find((a) => a.id === "move")!;
const B: [number, number] = [0.375, 0.125];

describe("planning moves on the map", () => {
  it("offers the moves every unit can take (any unit can move stealthily now), normal first", () => {
    const ids = moveActionsFor(rules, [g1, g2]).map((a) => a.id);
    expect(ids[0]).toBe("move");
    expect(ids).toContain("move-force-march");
    expect(ids).toContain("move-stealth");
  });

  it("makes a filled-in move order, as a free action", () => {
    const o = newOrder(rules, move, { unitIds: [g1.id, g2.id], path: [B] }, true, "o1");
    expect(o).toMatchObject({ id: "o1", kind: "free", actionTypeId: "move", inputs: { "0": [g1.id, g2.id], "1": [B] } });
    expect(validateOrders(rules, view, [o]).orders[0].problems).toEqual([]);
  });

  it("starts a new move where the units end up after queued ones", () => {
    const o = newOrder(rules, move, { unitIds: [g1.id], path: [B] }, true, "o1");
    const check = validateOrders(rules, view, [o]);
    const s = moveStart(check, [g1.id]);
    expect(s).toMatchObject({ regionId: "b", at: B });
    expect("used" in s && s.used[0]).toBeCloseTo(0.5);
    expect(moveStart(check, [g1.id, g2.id])).toHaveProperty("error");
  });

  it("previews a blocked border and running out of movement", () => {
    const start = moveStart(validateOrders(rules, view, []), [g1.id]);
    if ("error" in start) throw new Error(start.error);
    const map = routeMapFromView(view);
    const ok = previewMove(rules, map, [g1], start, [B], move);
    expect(ok.endRegion).toBe("b");
    expect(ok.blocked).toBeUndefined();
    // b—c is blocked (and c is out of sight, so the team doesn't know the way).
    expect(previewMove(rules, map, [g1], start, [[0.625, 0.125]], move).endRegion).not.toBe("c");
    // 24 miles a round: back and forth across a—b three times is 36.
    const far = previewMove(rules, map, [g1], start, [B, [0.125, 0.125], B, [0.125, 0.125]], move);
    expect(far.outOfMovement).toBe(true);
  });

  it("repositions units inside their own region, using miles", () => {
    const start = moveStart(validateOrders(rules, view, []), [g1.id]);
    if ("error" in start) throw new Error(start.error);
    const spot: [number, number] = [0.2, 0.2];
    const route = previewMove(rules, routeMapFromView(view), [g1], start, [spot], move);
    expect(route.endRegion).toBe("a");
    expect(route.blocked).toBeUndefined();
    // From the centre (0.125, 0.125): about 5 of the 48 miles across.
    expect(route.miles[0]).toBeCloseTo(Math.hypot(0.075, 0.075) * 48, 1);
    const check = validateOrders(rules, view, [newOrder(rules, move, { unitIds: [g1.id], path: [spot] }, true, "o1")]);
    expect(check.orders[0].problems).toEqual([]);
    expect(check.units[g1.id]).toMatchObject({ regionId: "a", at: spot });
    expect(check.units[g1.id].used).toBeGreaterThan(0);
  });

  it("joins a move already going from the same region to the same region", () => {
    const o = newOrder(rules, move, { unitIds: [g1.id], path: [B] }, true, "o1");
    expect(findJoin(rules, view, [o], move, [g2.id], "a", "b")?.id).toBe("o1");
    expect(findJoin(rules, view, [o], move, [g2.id], "a", "a")).toBeNull();
    // A unit that already has a move of its own doesn't join another.
    expect(findJoin(rules, view, [o], move, [g1.id], "a", "b")).toBeNull();
    const joined = joinOrder(rules, o, [g2.id]);
    expect(orderUnits(rules, joined)).toEqual([g1.id, g2.id]);
    expect(validateOrders(rules, view, [joined]).orders[0].problems).toEqual([]);
    expect(withPath(rules, joined, [[0.2, 0.1]]).inputs["1"]).toEqual([[0.2, 0.1]]);
  });
});

