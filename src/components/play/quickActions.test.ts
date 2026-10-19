import { describe, expect, it } from "vitest";
import { unitTags } from "@/engine/ruleset/derive";
import type { WorldUnit } from "@/engine/world/types";
import { buildPreset } from "@/presets";
import { quickActions } from "./quickActions";

const rules = buildPreset("utterdark");

function unit(creatureId: string): WorldUnit {
  return {
    id: "u1",
    ownerTeamId: "t1",
    creatureId,
    name: "",
    raceId: null,
    archetypeId: null,
    academyBonus: {},
    augmentIds: [],
    hp: 10,
    regionId: "r1",
    milesUsed: 0,
    status: "active",
    isLeader: false,
    usesSpent: {},
  };
}

const tagged = (tag: string, has: boolean) => rules.creatures.find((c) => c.recruitable && unitTags(rules, c, null).includes(tag) === has)!;

describe("quick actions", () => {
  it("offers a unit's moves first, and only actions that take a unit", () => {
    const list = quickActions(rules, { kind: "unit", unit: unit(tagged("Stealthy", false).id) });
    expect(list.length).toBeGreaterThan(1);
    const firstOther = list.findIndex((a) => a.handler !== "move");
    expect(list.slice(0, firstOther).every((a) => a.handler === "move")).toBe(true);
    expect(list.slice(firstOther).every((a) => a.handler !== "move")).toBe(true);
    expect(list.every((a) => a.inputs.some((i) => i.type === "unit"))).toBe(true);
    expect(list.some((a) => a.kind === "conditional")).toBe(false);
  });

  it("leaves out actions that need a tag the unit doesn't have", () => {
    const plain = quickActions(rules, { kind: "unit", unit: unit(tagged("Stealthy", false).id) }).map((a) => a.id);
    expect(plain).not.toContain("move-stealth");
    const sneaky = rules.creatures.find((c) => unitTags(rules, c, null).includes("Stealthy"));
    if (sneaky) expect(quickActions(rules, { kind: "unit", unit: unit(sneaky.id) }).map((a) => a.id)).toContain("move-stealth");
  });

  it("offers monster-only attacks against wild monsters but not against teams", () => {
    const other = { id: "o1", creatureId: "x", creatureName: "X", regionId: "r1", dead: false };
    const vsWild = quickActions(rules, { kind: "other", unit: { ...other, ownerTeamId: null } });
    const vsTeam = quickActions(rules, { kind: "other", unit: { ...other, ownerTeamId: "t2" } });
    const monsterOnly = rules.actionTypes.filter((a) => a.inputs.some((i) => i.type === "targetUnit" && i.monstersOnly)).map((a) => a.id);
    expect(monsterOnly.length).toBeGreaterThan(0);
    for (const id of monsterOnly) {
      expect(vsWild.map((a) => a.id)).toContain(id);
      expect(vsTeam.map((a) => a.id)).not.toContain(id);
    }
  });

  it("offers actions that take a region for a region", () => {
    const region = { id: "r1", code: "A1", x: 0, y: 0, state: "visible" as const, name: "", description: "", settleable: true, ownerTeamId: "t1", settlementTierId: null, buildings: [], structures: [], deposits: [], features: [], lastSeenRound: null };
    const list = quickActions(rules, { kind: "region", region });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.inputs.some((i) => i.type === "region"))).toBe(true);
  });
});
