import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { lendLabel, lendProblem } from "./lending";
import { validateOrders, type OrderDraft } from "./orders/validate";
import { resolveOrder } from "./resolve/resolveOrder";
import type { World } from "./resolve/types";
import { buildTeamView, movableUnits } from "./world/teamView";
import type { WorldConnection, WorldRegion, WorldUnit } from "./world/types";

const r = buildPreset("utterdark");
const ME = "team-me";
const THEM = "team-them";
const OTHER = "team-other";

// Five square regions in a row, a | b | c | d | e, a fifth of the map wide.
// Units see only their own region, so a unit far off shows what it alone sees.
const fifth = 1 / 5;
function region(id: string, i: number, extra: Partial<WorldRegion> = {}): WorldRegion {
  return {
    id,
    code: id.toUpperCase(),
    name: `Region ${id}`,
    description: "",
    x: (i + 0.5) * fifth,
    y: fifth / 2,
    polygon: [
      [i * fifth, 0],
      [(i + 1) * fifth, 0],
      [(i + 1) * fifth, fifth],
      [i * fifth, fifth],
    ],
    settleable: true,
    hidden: false,
    ownerTeamId: null,
    settlementTierId: null,
    buildings: [],
    structures: [],
    deposits: [],
    features: [],
    ...extra,
  };
}
const conn = (a: string, b: string): WorldConnection => ({ id: `${a}-${b}`, regionA: a, regionB: b, kind: "border", blocked: false, miles: null, terrainId: "normal", hidden: false });
let n = 0;
const uid = () => `20000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const unit = (extra: Partial<WorldUnit>): WorldUnit => ({
  id: uid(),
  ownerTeamId: ME,
  creatureId: "guard",
  name: "",
  raceId: null,
  archetypeId: null,
  academyBonus: {},
  augmentIds: [],
  hp: 11,
  regionId: "a",
  x: null,
  y: null,
  milesUsed: 0,
  status: "active",
  isLeader: false,
  usesSpent: {},
  ...extra,
});
const teams = [ME, THEM, OTHER].map((id) => ({ id, name: id === ME ? "Me" : id === THEM ? "Them" : "Other", colour: "#888", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [] }));
const regions = [region("a", 0, { ownerTeamId: ME, settlementTierId: "outpost" }), region("b", 1), region("c", 2), region("d", 3), region("e", 4, { ownerTeamId: OTHER, settlementTierId: "outpost" })];
const connections = [conn("a", "b"), conn("b", "c"), conn("c", "d"), conn("d", "e")];

const mine = unit({ name: "Mine" });
// Them's scout, lent to me, standing in d (far from anything of mine).
const lent = unit({ ownerTeamId: THEM, regionId: "d", name: "Borrowed", lentToTeamId: ME });
const theirs = unit({ ownerTeamId: THEM, regionId: "d", name: "Not lent" });
const units = [mine, lent, theirs];

const viewOf = (teamId: string, us = units) =>
  buildTeamView({
    ruleset: r,
    regions,
    connections,
    units: us,
    teams,
    team: { ...teams.find((t) => t.id === teamId)!, secretObjectives: "" },
    knowledge: { regions: new Map(), connections: new Set(), detectedUnits: new Set() },
    terrain: [],
    map: { aspect: 1, milesAcross: 60 },
    inventory: {},
    round: 1,
  });
const world = (us = units): World => ({ regions, connections, units: us, teams, inventory: {}, map: { aspect: 1, milesAcross: 60 } });
const order = (actionTypeId: string, inputs: Record<string, unknown>, kind: OrderDraft["kind"] = "free"): OrderDraft => ({ id: uid(), kind, actionTypeId, inputs, notes: "" });
const C: [number, number] = [2.5 * fifth, fifth / 2];

describe("lending units", () => {
  it("only lets the owner lend, to a team it has met, outside resolution", () => {
    const u = { ownerTeamId: ME, status: "active", lentToTeamId: null };
    expect(lendProblem(u, ME, THEM, [THEM], false)).toBeNull();
    expect(lendProblem(u, THEM, ME, [ME], false)).toMatch(/isn't yours/);
    expect(lendProblem(u, ME, OTHER, [THEM], false)).toMatch(/met/);
    expect(lendProblem(u, ME, ME, [ME], false)).toMatch(/yourself/);
    expect(lendProblem(u, ME, THEM, [THEM], true)).toMatch(/resolved/);
    expect(lendProblem({ ...u, status: "dead" }, ME, THEM, [THEM], false)).toMatch(/on the map/);
    expect(lendProblem({ ...u, lentToTeamId: THEM }, ME, THEM, [THEM], false)).toMatch(/already/);
    // Taking back: only a lent unit, any time outside resolution (even if the teams fell out).
    expect(lendProblem({ ...u, lentToTeamId: THEM }, ME, null, [], false)).toBeNull();
    expect(lendProblem(u, ME, null, [], false)).toMatch(/isn't lent/);
    expect(lendProblem(undefined, ME, null, [], false)).toMatch(/isn't yours/);
  });

  it("says who controls a lent unit, to the owner and the borrower only", () => {
    const name = (id: string) => (id === ME ? "Me" : "Them");
    expect(lendLabel(lent, THEM, name)).toBe("Lent to Me");
    expect(lendLabel(lent, ME, name)).toBe("Lent to you by Them");
    expect(lendLabel(lent, OTHER, name)).toBeNull();
    expect(lendLabel(mine, ME, name)).toBeNull();
  });

  it("gives the borrower the unit in full, and vision through it", () => {
    const v = viewOf(ME);
    expect(v.lentUnits?.map((u) => u.id)).toEqual([lent.id]);
    expect(v.lentUnits?.[0]).toMatchObject({ name: "Borrowed", hp: 11 });
    expect(v.otherUnits.map((u) => u.id)).toEqual([theirs.id]);
    expect(v.regions.find((x) => x.id === "d")?.state).toBe("visible");
    // The lender appears among the teams, so the borrower can see its name.
    expect(v.teams.map((t) => t.id)).toContain(THEM);
    expect(movableUnits(v).map((u) => u.id)).toEqual([mine.id, lent.id]);
    // Taken back: the borrower loses it, and what it saw.
    const back = viewOf(ME, [mine, { ...lent, lentToTeamId: null }, theirs]);
    expect(back.lentUnits).toEqual([]);
    expect(back.regions.find((x) => x.id === "d")?.state).not.toBe("visible");
  });

  it("keeps the unit the owner's own, and shows a third team only its type and owner", () => {
    const owner = viewOf(THEM);
    expect(owner.ownUnits.find((u) => u.id === lent.id)?.lentToTeamId).toBe(ME);
    expect(owner.teams.map((t) => t.id)).toContain(ME);
    const third = viewOf(OTHER, [{ ...lent, regionId: "e" }]);
    expect(third.lentUnits).toEqual([]);
    expect(third.otherUnits).toEqual([expect.objectContaining({ id: lent.id, ownerTeamId: THEM, creatureName: "Guard" })]);
    expect(third.otherUnits[0]).not.toHaveProperty("name");
    expect(third.otherUnits[0]).not.toHaveProperty("lentToTeamId");
  });

  it("lets the borrower move it (alone or with its own units), and nothing else", () => {
    const v = viewOf(ME);
    const moveIt = order("move", { "0": [lent.id], "1": [C] });
    expect(validateOrders(r, v, [moveIt]).orders[0].problems).toEqual([]);
    expect(validateOrders(r, v, [moveIt]).units[lent.id].regionId).toBe("c");
    expect(validateOrders(r, v, [order("spy", { "0": lent.id })]).orders[0].problems.join()).toMatch(/lent to you/);
    // Units moving together must start in the same region.
    const together = order("move", { "0": [mine.id, lent.id], "1": [C] });
    expect(validateOrders(r, v, [together]).orders[0].problems.join()).toMatch(/same region/);
    const side = viewOf(ME, [mine, { ...lent, regionId: "a" }]);
    expect(validateOrders(r, side, [together]).orders[0].problems).toEqual([]);
  });

  it("resolves the borrower's move, and fails it once the unit is taken back", () => {
    const moveIt = order("move", { "0": [lent.id], "1": [C] });
    const p = resolveOrder({ ruleset: r, world: world(), teamId: ME, order: moveIt, round: 1, seed: "s" });
    expect(p.status).not.toBe("invalid");
    expect(p.changes).toContainEqual(expect.objectContaining({ type: "moveUnit", unitId: lent.id, regionId: "c" }));
    const back = world([mine, { ...lent, lentToTeamId: null }, theirs]);
    const q = resolveOrder({ ruleset: r, world: back, teamId: ME, order: moveIt, round: 1, seed: "s" });
    expect(q.status).toBe("invalid");
    expect(q.changes).toEqual([]);
  });

  it("still lets the owner move a unit it has lent", () => {
    const moveIt = order("move", { "0": [lent.id], "1": [C] });
    expect(validateOrders(r, viewOf(THEM), [moveIt]).orders[0].problems).toEqual([]);
    const p = resolveOrder({ ruleset: r, world: world(), teamId: THEM, order: moveIt, round: 1, seed: "s" });
    expect(p.changes).toContainEqual(expect.objectContaining({ type: "moveUnit", unitId: lent.id }));
  });
});
