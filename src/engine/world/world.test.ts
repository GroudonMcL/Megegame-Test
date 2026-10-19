import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { validateOrders, type OrderDraft } from "../orders/validate";
import { milesPerRound, reachable } from "../orders/movement";
import { projectEconomy } from "../orders/economy";
import { buildTeamView, playerRuleset } from "./teamView";
import { computeVisibility } from "./visibility";
import type { TeamKnowledge, WorldConnection, WorldRegion, WorldUnit } from "./types";

const r = buildPreset("utterdark");
const ME = "team-me";
const THEM = "team-them";

function region(id: string, extra: Partial<WorldRegion> = {}): WorldRegion {
  return {
    id,
    code: id.toUpperCase(),
    name: "",
    description: "",
    x: 0.5,
    y: 0.5,
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
function conn(a: string, b: string, extra: Partial<WorldConnection> = {}): WorldConnection {
  return { id: `${a}-${b}`, regionA: a, regionB: b, miles: null, terrainId: "normal", hidden: false, ...extra };
}
let n = 0;
function unit(extra: Partial<WorldUnit>): WorldUnit {
  return {
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    ownerTeamId: ME,
    creatureId: "guard",
    name: "",
    raceId: null,
    archetypeId: null,
    academyBonus: {},
    augmentIds: [],
    hp: 10,
    regionId: "a",
    milesUsed: 0,
    status: "active",
    isLeader: false,
    usesSpent: {},
    ...extra,
  };
}
const noKnowledge = (): TeamKnowledge => ({ regions: new Map(), connections: new Set(), detectedUnits: new Set() });

// a — b — c — d, plus a hidden region h off b and a hidden connection a—c.
const regions = [
  region("a", { ownerTeamId: ME, settlementTierId: "outpost" }),
  region("b"),
  region("c", { ownerTeamId: THEM }),
  region("d"),
  region("h", { hidden: true }),
];
const connections = [conn("a", "b"), conn("b", "c"), conn("c", "d"), conn("b", "h"), conn("a", "c", { hidden: true })];

describe("visibility", () => {
  it("sees owned regions and regions with units; neighbours are unexplored", () => {
    const v = computeVisibility(r, { regions, connections, units: [unit({ regionId: "a" })] }, ME, noKnowledge());
    expect(v.regions.get("a")).toBe("visible");
    expect(v.regions.get("b")).toBe("frontier");
    expect(v.regions.has("c")).toBe(false);
    expect(v.regions.has("h")).toBe(false);
    // The hidden a—c connection isn't known, so c isn't even a frontier.
    expect(v.connections.has("a-c")).toBe(false);
  });

  it("a scout sees adjacent regions, but not hidden ones", () => {
    const scout = unit({ creatureId: "scout", archetypeId: "scout", regionId: "b" });
    const v = computeVisibility(r, { regions, connections, units: [scout] }, ME, noKnowledge());
    expect(v.regions.get("c")).toBe("visible");
    expect(v.regions.get("a")).toBe("visible");
    expect(v.regions.has("h")).toBe(false);
    expect(v.regions.get("d")).toBe("frontier");
  });

  it("discovered hidden regions and connections become visible", () => {
    const k = noKnowledge();
    k.regions.set("h", { discovered: true, searched: false, permanentVision: false, lastSeen: null, lastSeenRound: null });
    k.connections.add("a-c");
    const scout = unit({ creatureId: "scout", archetypeId: "scout", regionId: "b" });
    const v = computeVisibility(r, { regions, connections, units: [scout] }, ME, k);
    expect(v.regions.get("h")).toBe("visible");
    expect(v.connections.has("a-c")).toBe(true);
  });

  it("stealthed enemies stay hidden until detected", () => {
    const sneaky = unit({ ownerTeamId: THEM, status: "hidden", regionId: "a" });
    const loud = unit({ ownerTeamId: null, creatureId: "giant-spider", regionId: "a" });
    const far = unit({ ownerTeamId: THEM, regionId: "d" });
    const units = [unit({ regionId: "a" }), sneaky, loud, far];
    const v = computeVisibility(r, { regions, connections, units }, ME, noKnowledge());
    expect(v.otherUnits.has(loud.id)).toBe(true);
    expect(v.otherUnits.has(sneaky.id)).toBe(false);
    expect(v.otherUnits.has(far.id)).toBe(false);
    const k = noKnowledge();
    k.detectedUnits.add(sneaky.id);
    expect(computeVisibility(r, { regions, connections, units }, ME, k).otherUnits.has(sneaky.id)).toBe(true);
  });

  it("remembers regions seen before, unless the DM turns that off", () => {
    const k = noKnowledge();
    const memory = { name: "Old", description: "", ownerTeamId: THEM, settlementTierId: null, buildings: [], structures: [], deposits: [] };
    k.regions.set("d", { discovered: true, searched: false, permanentVision: false, lastSeen: memory, lastSeenRound: 2 });
    expect(computeVisibility(r, { regions, connections, units: [] }, ME, k).regions.get("d")).toBe("remembered");
    const off = { ...r, settings: { ...r.settings, fog: { ...r.settings.fog, showPreviouslySeen: false } } };
    expect(computeVisibility(off, { regions, connections, units: [] }, ME, k).regions.has("d")).toBe(false);
  });
});

describe("team view", () => {
  it("sends other units as type and owner only, and nothing about unseen regions", () => {
    const enemy = unit({ ownerTeamId: THEM, name: "Secret Name", regionId: "a", augmentIds: ["x"] });
    const view = buildTeamView({
      ruleset: r,
      regions,
      connections,
      units: [unit({ regionId: "a" }), enemy],
      teams: [
        { id: ME, name: "Me", colour: "#000", isNpc: false },
        { id: THEM, name: "Them", colour: "#fff", isNpc: false },
      ],
      team: { id: ME, name: "Me", colour: "#000", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [], secretObjectives: "" },
      knowledge: noKnowledge(),
      inventory: {},
      round: 1,
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain("Secret Name");
    expect(view.otherUnits[0]).toEqual({ id: enemy.id, creatureId: "guard", creatureName: "Guard", ownerTeamId: THEM, regionId: "a", dead: false });
    expect(view.regions.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(view.regions.find((x) => x.id === "b")!.name).toBe("");
    expect(view.teams.map((t) => t.id)).toEqual([THEM]);
  });

  it("the player ruleset hides roll-table outcomes, unmet monsters and unknown recipes", () => {
    const pr = playerRuleset(r, { metCreatureIds: ["giant-spider"], ownCreatureIds: [], knownRecipeIds: [] });
    expect(pr.rollTables.every((t) => t.bands.length === 1 && t.bands[0].text === "")).toBe(true);
    expect(pr.creatures.some((c) => c.id === "drider")).toBe(false);
    expect(pr.creatures.some((c) => c.id === "giant-spider")).toBe(true);
    expect(pr.creatures.some((c) => c.id === "guard")).toBe(true);
    expect(pr.recipes.every((x) => x.knownAtStart)).toBe(true);
  });
});

describe("movement", () => {
  it("a 30 ft unit covers 24 miles a round: two 12-mile regions", () => {
    const g = unit({ regionId: "a" });
    expect(milesPerRound(r, g)).toBe(24);
    const reach = reachable(r, connections.filter((c) => !c.hidden), "a", [{ unit: g, used: 0 }], "normal");
    expect([...reach.keys()].sort()).toEqual(["a", "b", "c", "h"]);
  });

  it("difficult terrain costs double; force march doubles the budget", () => {
    const hard = [conn("a", "b", { terrainId: "difficult" }), conn("b", "c")];
    const g = unit({ regionId: "a" });
    expect([...reachable(r, hard, "a", [{ unit: g, used: 0 }], "normal").keys()].sort()).toEqual(["a", "b"]);
    expect([...reachable(r, hard, "a", [{ unit: g, used: 0 }], "forceMarch").keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("flooded passages need a swim or fly speed", () => {
    const wet = [conn("a", "b", { terrainId: "water" })];
    expect(reachable(r, wet, "a", [{ unit: unit({}), used: 0 }], "normal").has("b")).toBe(false);
  });
});

describe("orders", () => {
  const baseView = (resources: Record<string, number>, units: WorldUnit[]) =>
    buildTeamView({
      ruleset: r,
      regions,
      connections,
      units,
      teams: [{ id: ME, name: "Me", colour: "#000", isNpc: false }],
      team: { id: ME, name: "Me", colour: "#000", isNpc: false, resources, baseRaceId: null, raceIds: [], knownRecipeIds: [], secretObjectives: "" },
      knowledge: noKnowledge(),
      inventory: {},
      round: 1,
    });
  const id = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const order = (i: number, actionTypeId: string, inputs: Record<string, unknown>, kind: OrderDraft["kind"] = "numbered"): OrderDraft => ({ id: id(i), kind, actionTypeId, inputs, notes: "" });

  it("blocks spending more than you have, with the amounts", () => {
    const v = baseView({ gold: 5, growth: 0 }, [unit({ regionId: "a" })]);
    const check = validateOrders(r, v, [order(1, "construct-building", { "0": "a", "1": "farm" }), order(2, "construct-building", { "0": "a", "1": "mine" })]);
    expect(check.orders[0].problems).toEqual([]);
    expect(check.orders[1].problems.some((p) => p.startsWith("Not enough Gold: need") && p.includes("you'll have 1"))).toBe(true);
  });

  it("tracks movement across several orders", () => {
    const g = unit({ regionId: "a" });
    const v = baseView({}, [g]);
    const check = validateOrders(r, v, [order(1, "move", { "0": [g.id], "1": ["b"] }), order(2, "move", { "0": [g.id], "1": ["c", "d"] })]);
    expect(check.orders[0].problems).toEqual([]);
    expect(check.orders[1].problems.join(" ")).toMatch(/no movement left|There's no known way/);
    expect(check.movement[0].milesLeft).toBeLessThan(24);
  });

  it("limits numbered slots and conditionals", () => {
    const v = baseView({}, []);
    const many = Array.from({ length: 7 }, (_, i) => order(i + 1, "improvise", { "0": "x" }));
    const check = validateOrders(r, v, many);
    expect(check.orders[6].problems).toContain("You only have 6 numbered actions.");
    const cond = validateOrders(r, v, [order(1, "improvise", { "0": "x" }, "conditional")]);
    expect(cond.orders[0].problems[0]).toMatch(/must come after/);
  });

  it("a conditional is checked as if its parent hadn't happened", () => {
    const v = baseView({ gold: 4 }, []);
    const check = validateOrders(r, v, [order(1, "construct-building", { "0": "a", "1": "farm" }), order(2, "construct-building", { "0": "a", "1": "farm" }, "conditional")]);
    expect(check.orders[1].problems).toEqual([]);
    expect(check.orders[1].parentId).toBe(id(1));
  });

  it("free actions granted by buildings are limited to the uses you have", () => {
    const v = baseView({}, []);
    const check = validateOrders(r, v, [order(1, "hunt", {}, "free")]);
    expect(check.orders[0].problems[0]).toMatch(/no uses of Hunt/);
  });

  it("projects the income and upkeep of what the orders build", () => {
    const v = baseView({ gold: 10, food: 0, growth: 0 }, []);
    const check = validateOrders(r, v, [order(1, "construct-building", { "0": "a", "1": "farm" })]);
    // Outpost +1 gold +5 growth; Farm costs 4 gold, upkeep 3 gold, makes 2 food and 5 growth.
    expect(check.economy.end).toMatchObject({ gold: 10 - 4 + 1 - 3, food: 2, growth: 10 });
  });

  it("projects income and upkeep", () => {
    const e = projectEconomy(r, { teamId: ME, resources: { gold: 10 }, regions, units: [unit({ regionId: "a" })] });
    // Outpost: +1 gold. Guard (CR 1/8): 2 gold upkeep.
    expect(e.end.gold).toBe(10 + 1 - 2);
  });
});
