import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { dmMoveNote, dmMoveOrder, dmMoveRecord, movedSince, normalMoveFor, planDmMove } from "./dmMoves";
import { validateOrders } from "./orders/validate";
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

  it("adds a normal move straight to the point, which the team's checks accept", () => {
    const guard = { creatureId: "guard", archetypeId: null };
    const action = normalMoveFor(r, [guard, guard]);
    expect(action?.id).toBe("move");
    const o = dmMoveOrder(action!, ["10000000-0000-4000-8000-000000000001"], [0.3, 0.1], "10000000-0000-4000-8000-0000000000aa");
    expect(o).toMatchObject({ kind: "free", actionTypeId: "move", inputs: { "0": ["10000000-0000-4000-8000-000000000001"], "1": [[0.3, 0.1]] } });
    const square = (i: number): [number, number][] => [
      [i / 4, 0],
      [(i + 1) / 4, 0],
      [(i + 1) / 4, 0.25],
      [i / 4, 0.25],
    ];
    const reg = (id: string, i: number) => ({ id, code: id, name: "", description: "", x: (i + 0.5) / 4, y: 0.125, polygon: square(i), settleable: true, hidden: false, ownerTeamId: null, settlementTierId: null, buildings: [], structures: [], deposits: [], features: [] });
    const view = buildTeamView({
      ruleset: r,
      regions: [reg("a", 0), reg("b", 1)],
      connections: [{ id: "ab", regionA: "a", regionB: "b", kind: "border", blocked: false, miles: null, terrainId: "normal", hidden: false }],
      units: [{ id: "10000000-0000-4000-8000-000000000001", ownerTeamId: "T", creatureId: "guard", name: "", raceId: null, archetypeId: null, academyBonus: {}, augmentIds: [], hp: 10, regionId: "a", x: null, y: null, milesUsed: 0, status: "active", isLeader: false, usesSpent: {} }],
      teams: [{ id: "T", name: "T", colour: "#000", isNpc: false }],
      team: { id: "T", name: "T", colour: "#000", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [], secretObjectives: "" },
      knowledge: { regions: new Map(), connections: new Set(), detectedUnits: new Set() },
      terrain: [],
      map: { aspect: 1, milesAcross: 48 },
      inventory: {},
      round: 1,
    });
    const check = validateOrders(r, view, [dmMoveOrder(action!, ["10000000-0000-4000-8000-000000000001"], [0.375, 0.125], "10000000-0000-4000-8000-0000000000aa")]);
    expect(check.orders[0].problems).toEqual([]);
    expect(check.units["10000000-0000-4000-8000-000000000001"].regionId).toBe("b");
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
