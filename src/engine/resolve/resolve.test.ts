import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { createRng } from "../rng";
import type { OrderDraft } from "../orders/validate";
import type { WorldConnection, WorldRegion, WorldUnit } from "../world/types";
import { applyChanges } from "./apply";
import { endOfRound } from "./endOfRound";
import { buildQueue, interactionFlags, scenes } from "./queue";
import { resolveOrder } from "./resolveOrder";
import { rollOnTable } from "./rollTable";
import type { World } from "./types";

const r = buildPreset("utterdark");
const ME = "team-me";
const THEM = "team-them";

function region(id: string, extra: Partial<WorldRegion> = {}): WorldRegion {
  return { id, code: id.toUpperCase(), name: "", description: "", x: 0, y: 0, settleable: true, hidden: false, ownerTeamId: null, settlementTierId: null, buildings: [], structures: [], deposits: [], features: [], ...extra };
}
const conn = (a: string, b: string): WorldConnection => ({ id: `${a}-${b}`, regionA: a, regionB: b, miles: null, terrainId: "normal", hidden: false });
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function unit(extra: Partial<WorldUnit>): WorldUnit {
  return { id: uid(), ownerTeamId: ME, creatureId: "guard", name: "", raceId: null, archetypeId: null, academyBonus: {}, augmentIds: [], hp: 11, regionId: "a", milesUsed: 0, status: "active", isLeader: false, ...extra };
}
function world(units: WorldUnit[], resources = { gold: 20, food: 5, growth: 50 }): World {
  return {
    regions: [region("a", { ownerTeamId: ME, settlementTierId: "outpost" }), region("b"), region("c", { ownerTeamId: THEM, settlementTierId: "outpost" })],
    connections: [conn("a", "b"), conn("b", "c")],
    units,
    teams: [
      { id: ME, name: "Me", colour: "#00f", isNpc: false, resources, baseRaceId: null, raceIds: [], knownRecipeIds: [] },
      { id: THEM, name: "Them", colour: "#f00", isNpc: false, resources: { gold: 5 }, baseRaceId: null, raceIds: [], knownRecipeIds: [] },
    ],
    inventory: {},
  };
}
const order = (actionTypeId: string, inputs: Record<string, unknown>, kind: OrderDraft["kind"] = "numbered"): OrderDraft => ({ id: uid(), kind, actionTypeId, inputs, notes: "" });
const resolve = (w: World, o: OrderDraft, teamId = ME) => resolveOrder({ ruleset: r, world: w, teamId, order: o, round: 1, seed: "s" });

describe("resolving orders", () => {
  it("builds a building: pays, adds it, and is ready", () => {
    const w = world([]);
    const p = resolve(w, order("construct-building", { "0": "a", "1": "farm" }));
    expect(p.status).toBe("ready");
    const after = applyChanges(w, p.changes);
    expect(after.regions[0].buildings).toEqual([{ buildingId: "farm", tier: 1 }]);
    expect(after.teams[0].resources.gold).toBe(16);
  });

  it("refuses what the real state doesn't allow", () => {
    const p = resolve(world([], { gold: 1, food: 0, growth: 0 }), order("construct-building", { "0": "a", "1": "farm" }));
    expect(p.status).toBe("invalid");
    expect(p.problems[0]).toMatch(/Not enough Gold/);
    expect(p.changes).toEqual([]);
  });

  it("moves units and spends their movement", () => {
    const g = unit({});
    const w = world([g]);
    const p = resolve(w, order("move", { "0": [g.id], "1": ["b"] }));
    const after = applyChanges(w, p.changes);
    expect(after.units[0].regionId).toBe("b");
    expect(after.units[0].milesUsed).toBe(12);
    expect(p.text).toContain("A → B");
  });

  it("flags units moving into other sides' regions", () => {
    const g = unit({ regionId: "b" });
    const enemy = unit({ ownerTeamId: THEM, regionId: "c" });
    const p = resolve(world([g, enemy]), order("move", { "0": [g.id], "1": ["c"] }));
    expect(p.status).toBe("needsReview");
    expect(p.notes.join(" ")).toMatch(/decide whether there's a fight/);
    expect(p.targetsTeams).toContain(THEM);
  });

  it("recruits a unit at full HP that can't move this round", () => {
    const w = world([]);
    const p = resolve(w, order("recruit", { "0": "a", "1": "guard", "3": "regiment" }));
    expect(p.problems).toEqual([]);
    const after = applyChanges(w, p.changes);
    const u = after.units[0];
    expect(u.archetypeId).toBe("regiment");
    expect(u.hp).toBeGreaterThan(0);
    expect(u.milesUsed).toBe(24);
  });

  it("rolls check actions on their table with the best ability", () => {
    const miner = unit({ archetypeId: "miner" });
    const p = resolve(world([miner]), order("excavate", { "0": miner.id, "1": "north" }, "free"));
    expect(p.rolls[0].tableId).toBe("excavate");
    expect(p.rolls[0].breakdown).toMatch(/STR|CON/);
    expect(p.status).toBe("needsReview");
  });

  it("the same seed gives the same result", () => {
    const miner = unit({ archetypeId: "miner" });
    const w = world([miner]);
    const o = order("excavate", { "0": miner.id, "1": "north" }, "free");
    expect(resolve(w, o).rolls[0].total).toBe(resolve(w, o).rolls[0].total);
  });
});

describe("roll tables", () => {
  it("chains into other tables", () => {
    // Explore 15+ adds a deposit; 10-14 rolls loot. Force a high roll with a big modifier.
    const res = rollOnTable(r, "extract", createRng("x"), { modifiers: [{ label: "test", value: 30 }] });
    expect(res.rolls.length).toBe(3);
    expect(res.results.every((x) => x.type === "gainItem")).toBe(true);
  });
});

describe("queue", () => {
  const o = (id: string, teamId: string, position: number, kind: string, slot: number | null, parentOrderId: string | null = null) => ({ id, teamId, position, kind, slot, parentOrderId });
  it("orders by slot, then team, with free actions after the slot before them", () => {
    const q = buildQueue(
      [o("a1", "A", 0, "free", null), o("a2", "A", 1, "numbered", 1), o("a3", "A", 2, "free", null), o("a4", "A", 3, "numbered", 2), o("a5", "A", 4, "conditional", null, "a4"), o("b1", "B", 0, "numbered", 1)],
      ["A", "B"],
    );
    expect(q.map((s) => [s.step, s.items.map((i) => i.id)])).toEqual([
      [1, ["a1", "a2", "a3", "b1"]],
      [2, ["a4", "a5"]],
    ]);
  });

  it("flags teams meeting in a region", () => {
    const g = unit({ regionId: "b" });
    const enemy = unit({ ownerTeamId: THEM, regionId: "c" });
    const w = world([g, enemy]);
    const mine = order("move", { "0": [g.id], "1": ["c"] });
    const p = resolve(w, mine);
    const flags = interactionFlags([{ id: mine.id, teamId: ME, proposal: p }], w);
    expect(flags.some((f) => f.kind === "meeting")).toBe(true);
    expect(scenes(flags).get(mine.id)).toBe(1);
  });
});

describe("end of round", () => {
  it("applies income and upkeep, and rolls a deficit when negative", () => {
    const w = world([unit({}), unit({}), unit({})], { gold: 1, food: 0, growth: 0 });
    const end = endOfRound(r, w, "seed");
    const me = end.teams.find((t) => t.teamId === ME)!;
    // Outpost +1 gold, three guards × 2 gold upkeep.
    expect(me.economy.end.gold).toBe(1 + 1 - 6);
    expect(me.rolls.some((x) => x.tableId === "economy-deficit")).toBe(true);
    const after = applyChanges(w, me.changes);
    expect(after.teams[0].resources.gold).toBe(-4);
  });

  it("hazards damage units in the region", () => {
    const g = unit({ regionId: "b" });
    const w = world([g]);
    w.regions[1].features = [{ type: "regionDamage", dice: "1d6", damageType: "fire", trigger: "roundStart" }];
    const end = endOfRound(r, w, "seed");
    const me = end.teams.find((t) => t.teamId === ME)!;
    expect(me.lines.some((l) => l.includes("fire damage"))).toBe(true);
  });
});
