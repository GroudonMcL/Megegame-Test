import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { dmMoveNote, dmMoveOrder, dmMoveRecord, keepDmFlags, movedSince, normalMoveFor, planDmMove } from "./dmMoves";
import { isDmMove, validateOrders } from "./orders/validate";
import { resolveOrder } from "./resolve/resolveOrder";
import { buildTeamView } from "./world/teamView";

const r = buildPreset("utterdark");

describe("the DM moving units on the World map", () => {
  it("moves wild monsters at once and splits team units by team", () => {
    const plan = planDmMove([
      { id: "w1", ownerTeamId: null },
      { id: "a1", ownerTeamId: "A" },
      { id: "b1", ownerTeamId: "B" },
      { id: "a2", ownerTeamId: "A" },
    ]);
    expect(plan.wild).toEqual(["w1"]);
    expect(plan.teams).toEqual([
      { teamId: "A", unitIds: ["a1", "a2"] },
      { teamId: "B", unitIds: ["b1"] },
    ]);
    expect(planDmMove([])).toEqual({ wild: [], teams: [] });
  });

  it("records where each unit was, so an instant move can be undone", () => {
    const rec = dmMoveRecord(
      [
        { unitId: "u1", regionId: "a", x: null, y: null },
        { unitId: "u2", regionId: "a", x: 0.1, y: 0.2 },
      ],
      { regionId: "b", at: [0.5, 0.6] },
    );
    expect(rec.before[1]).toEqual({ unitId: "u2", regionId: "a", x: 0.1, y: 0.2 });
    expect(rec.after).toEqual([
      { unitId: "u1", regionId: "b", x: 0.5, y: 0.6 },
      { unitId: "u2", regionId: "b", x: 0.5, y: 0.6 },
    ]);
    // Safe to undo while they're still there; not once one has moved on or gone.
    expect(movedSince(rec.after, rec.after)).toEqual([]);
    expect(movedSince(rec.after, [rec.after[0], { ...rec.after[1], x: 0.7 }])).toEqual(["u2"]);
    expect(movedSince(rec.after, [rec.after[0]])).toEqual(["u2"]);
    expect(movedSince(rec.after, [{ ...rec.after[0], regionId: "c" }, rec.after[1]])).toEqual(["u1"]);
  });

  it("adds a normal move straight to the point, across a blocked border but not beyond its miles", () => {
    const guard = { creatureId: "guard", archetypeId: null };
    const action = normalMoveFor(r, [guard, guard]);
    expect(action?.id).toBe("move");
    const o = dmMoveOrder(action!, ["10000000-0000-4000-8000-000000000001"], [0.3, 0.1], "10000000-0000-4000-8000-0000000000aa");
    expect(o).toMatchObject({ kind: "free", actionTypeId: "move", inputs: { "0": ["10000000-0000-4000-8000-000000000001"], "1": [[0.3, 0.1]], dm: true } });
    const square = (i: number): [number, number][] => [
      [i / 4, 0],
      [(i + 1) / 4, 0],
      [(i + 1) / 4, 0.25],
      [i / 4, 0.25],
    ];
    const reg = (id: string, i: number) => ({ id, code: id, name: "", description: "", x: (i + 0.5) / 4, y: 0.125, polygon: square(i), settleable: true, hidden: false, ownerTeamId: null, settlementTierId: null, buildings: [], structures: [], deposits: [], features: [] });
    const U = "10000000-0000-4000-8000-000000000001";
    // The team owns b, so it can see it past the blocked border.
    const regions = [reg("a", 0), { ...reg("b", 1), ownerTeamId: "T" }, reg("c", 2), reg("d", 3)];
    const connections = ["ab", "bc", "cd"].map((id) => ({ id, regionA: id[0], regionB: id[1], kind: "border", blocked: id === "ab", miles: null, terrainId: "normal", hidden: false }));
    const units = [{ id: U, ownerTeamId: "T", creatureId: "guard", name: "", raceId: null, archetypeId: null, academyBonus: {}, equippedItemIds: [], hp: 10, regionId: "a", x: null, y: null, milesUsed: 0, status: "active", isLeader: false, usesSpent: {} }];
    const view = buildTeamView({
      ruleset: r,
      regions,
      connections,
      units,
      teams: [{ id: "T", name: "T", colour: "#000", isNpc: false }],
      team: { id: "T", name: "T", colour: "#000", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [], secretObjectives: "" },
      knowledge: { regions: new Map(), connections: new Set(), detectedUnits: new Set() },
      terrain: [],
      map: { aspect: 1, milesAcross: 48 },
      inventory: {},
      round: 1,
    });
    const B: [number, number] = [0.375, 0.125];
    const dmOrder = dmMoveOrder(action!, [U], B, "10000000-0000-4000-8000-0000000000aa");
    // a—b is blocked: the DM's move goes across, a team's own move doesn't.
    const check = validateOrders(r, view, [dmOrder]);
    expect(check.orders[0].problems).toEqual([]);
    expect(check.units[U].regionId).toBe("b");
    const plain = { ...dmOrder.inputs };
    delete plain.dm;
    expect(validateOrders(r, view, [{ ...dmOrder, inputs: plain }]).orders[0].problems.join()).toMatch(/blocked/);
    // 36 miles to d's far side is more than a guard's 24 a round, DM or not.
    const far = validateOrders(r, view, [dmMoveOrder(action!, [U], [0.99, 0.125], "10000000-0000-4000-8000-0000000000ab")]);
    expect(far.orders[0].problems.join()).toMatch(/miles of movement left/);

    // Resolved the same way: across the border, as far as the miles go.
    const world = { regions, connections, units, teams: [{ id: "T", name: "T", colour: "#000", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [] }], inventory: {}, map: { aspect: 1, milesAcross: 48 } };
    const p = resolveOrder({ ruleset: r, world, teamId: "T", order: dmOrder, round: 1, seed: "s" });
    expect(p.changes).toContainEqual(expect.objectContaining({ type: "moveUnit", unitId: U, regionId: "b" }));
  });

  it("keeps the DM's mark only on the DM's moves the team left alone", () => {
    const action = normalMoveFor(r, [{ creatureId: "guard", archetypeId: null }])!;
    const stored = dmMoveOrder(action, ["u1"], [0.3, 0.1], "o1");
    // Saved back unchanged (even with its keys in another order): kept.
    expect(isDmMove(keepDmFlags([{ ...stored, inputs: { dm: true, "1": [[0.3, 0.1]], "0": ["u1"] } }], [stored])[0])).toBe(true);
    // Redrawn, or with units added: dropped.
    expect(isDmMove(keepDmFlags([{ ...stored, inputs: { ...stored.inputs, "1": [[0.5, 0.1]] } }], [stored])[0])).toBe(false);
    expect(isDmMove(keepDmFlags([{ ...stored, inputs: { ...stored.inputs, "0": ["u1", "u2"] } }], [stored])[0])).toBe(false);
    // A player can't add it to a move of their own, or copy it onto a new order.
    const own = { id: "o2", kind: "free" as const, actionTypeId: "move", inputs: { "0": ["u1"], "1": [[0.5, 0.1]], dm: true }, notes: "" };
    const cleaned = keepDmFlags([own, { ...stored, id: "o3" }], [stored]);
    expect(cleaned.map(isDmMove)).toEqual([false, false]);
    expect(cleaned[0].inputs).toEqual({ "0": ["u1"], "1": [[0.5, 0.1]] });
    // Orders without the mark pass through as they are.
    expect(keepDmFlags([{ ...own, inputs: { "0": ["u1"] } }], [])[0]).toEqual({ ...own, inputs: { "0": ["u1"] } });
  });

  it("finds no normal move when none suits every unit", () => {
    const noMoves = { ...r, actionTypes: r.actionTypes.filter((a) => a.id !== "move") };
    expect(normalMoveFor(noMoves, [{ creatureId: "guard", archetypeId: null }])).toBeNull();
  });

  it("suggests a note for the team", () => {
    expect(dmMoveNote(["Bram"], "C4", false)).toBe("The DM moved Bram to C4.");
    expect(dmMoveNote(["Bram", "Ash"], "C4", true)).toBe("The DM added a move to your orders: Bram and Ash to C4.");
    expect(dmMoveNote(["Bram", "Ash", "Kit"], "C4", false)).toBe("The DM moved Bram and 2 others to C4.");
  });
});
