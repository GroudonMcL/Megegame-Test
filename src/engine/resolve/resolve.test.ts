import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { createRng } from "../rng";
import type { OrderDraft } from "../orders/validate";
import type { WorldConnection, WorldRegion, WorldUnit } from "../world/types";
import { applyChanges } from "./apply";
import { endOfRound } from "./endOfRound";
import { buildQueue, interactionFlags, scenes } from "./queue";
import { orderCombatOdds, resolveOrder } from "./resolveOrder";
import { rollOnTable } from "./rollTable";
import { watchers } from "../stealth/stealth";
import { EMPTY_BUNDLE, executeTrade } from "../trades";
import type { World } from "./types";

const r = buildPreset("utterdark");
const ME = "team-me";
const THEM = "team-them";

// Three square regions in a row, a | b | c, a third of the map wide each. The
// map is 36 miles across, so centre to centre is 12 miles (as old connections were).
const third = 1 / 3;
const square = (i: number): [number, number][] => [
  [i * third, 0],
  [(i + 1) * third, 0],
  [(i + 1) * third, third],
  [i * third, third],
];
const SHAPES: Record<string, { polygon: [number, number][]; x: number; y: number }> = {
  a: { polygon: square(0), x: third / 2, y: third / 2 },
  b: { polygon: square(1), x: 1.5 * third, y: third / 2 },
  c: { polygon: square(2), x: 2.5 * third, y: third / 2 },
};
/** The centre of a region, as a path point. */
const at = (id: string): [number, number] => [SHAPES[id].x, SHAPES[id].y];
function region(id: string, extra: Partial<WorldRegion> = {}): WorldRegion {
  return { id, code: id.toUpperCase(), name: "", description: "", x: SHAPES[id]?.x ?? 0, y: SHAPES[id]?.y ?? 0, polygon: SHAPES[id]?.polygon ?? [], settleable: true, hidden: false, ownerTeamId: null, settlementTierId: null, buildings: [], structures: [], deposits: [], features: [], ...extra };
}
const conn = (a: string, b: string): WorldConnection => ({ id: `${a}-${b}`, regionA: a, regionB: b, kind: "border", blocked: false, miles: null, terrainId: "normal", hidden: false });
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function unit(extra: Partial<WorldUnit>): WorldUnit {
  return { id: uid(), ownerTeamId: ME, creatureId: "guard", name: "", raceId: null, archetypeId: null, academyBonus: {}, equippedItemIds: [], hp: 11, regionId: "a", x: null, y: null, milesUsed: 0, status: "active", isLeader: false, usesSpent: {}, ...extra } as WorldUnit;
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
    map: { aspect: 1, milesAcross: 36 },
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
    const p = resolve(w, order("move", { "0": [g.id], "1": [at("b")] }));
    const after = applyChanges(w, p.changes);
    expect(after.units[0].regionId).toBe("b");
    expect(after.units[0].milesUsed).toBeCloseTo(12);
    expect(p.text).toContain("A → B");
  });

  it("flags units moving into other sides' regions", () => {
    const g = unit({ regionId: "b" });
    const enemy = unit({ ownerTeamId: THEM, regionId: "c" });
    const p = resolve(world([g, enemy]), order("move", { "0": [g.id], "1": [at("c")] }));
    expect(p.status).toBe("needsReview");
    expect(p.notes.join(" ")).toMatch(/only fight through an Attack order/);
    expect(p.targetsTeams).toContain(THEM);
    expect(p.combats).toBeUndefined();
  });

  it("stops a move at the first region with monsters and fights them", () => {
    const g = unit({ creatureId: "knight", hp: 52 });
    const lizard = unit({ ownerTeamId: null, creatureId: "giant-lizard", hp: 19, regionId: "b" });
    const w = world([g, lizard]);
    const p = resolve(w, order("move", { "0": [g.id], "1": [at("b"), at("c")] }));
    expect(p.combats).toHaveLength(1);
    expect(p.status).toBe("needsReview");
    expect(p.text).toMatch(/stopped there/);
    expect(p.text).toMatch(/Fight in B against Wild monsters/);
    const after = applyChanges(w, p.changes);
    const knight = after.units.find((u) => u.id === g.id)!;
    const res = p.combats![0];
    const mine = res.units.find((u) => u.unitId === g.id)!;
    expect(knight.regionId).toBe(mine.outcome === "retreated" ? "a" : "b");
    expect(knight.hp).toBe(mine.hp);
    expect(after.units.find((u) => u.id === lizard.id)!.status).toBe(res.units.find((u) => u.unitId === lizard.id)!.outcome === "dead" ? "dead" : "active");
    // Same seed, same fight.
    expect(resolve(w, order("move", { "0": [g.id], "1": [at("b"), at("c")] })).combats![0].log).toEqual(res.log);
  });

  it("leaves the fight to the DM when asked", () => {
    const g = unit({ creatureId: "knight", hp: 52 });
    const lizard = unit({ ownerTeamId: null, creatureId: "giant-lizard", hp: 19, regionId: "b" });
    const p = resolveOrder({ ruleset: r, world: world([g, lizard]), teamId: ME, order: order("move", { "0": [g.id], "1": [at("b")] }), round: 1, seed: "s", combat: { byHand: true } });
    expect(p.combats).toBeUndefined();
    expect(p.status).toBe("needsDm");
  });

  it("attacks another team's units, focusing the target, and tells them", () => {
    const mine = [unit({ creatureId: "knight", hp: 52, regionId: "c" }), unit({ creatureId: "knight", hp: 52, regionId: "c" })];
    const target = unit({ ownerTeamId: THEM, regionId: "c" });
    const friend = unit({ ownerTeamId: THEM, regionId: "c" });
    const p = resolve(world([...mine, target, friend]), order("attack", { "0": mine.map((u) => u.id), "1": target.id }));
    expect(p.problems).toEqual([]);
    const res = p.combats![0];
    expect(res.units.filter((u) => u.sideId === THEM).map((u) => u.unitId).sort()).toEqual([target.id, friend.id].sort());
    const firstHit = res.log.find((l) => l.kind === "attack" && l.text.startsWith("Knight"));
    expect(firstHit?.text).toContain(`→ Guard ${res.units.find((u) => u.unitId === target.id)!.label.match(/Guard (\d)/)![1]}`);
    expect(p.reports?.[0].teamId).toBe(THEM);
    expect(p.reports?.[0].text).toMatch(/attacked by Me/);
  });

  it("hidden attackers start at range or in melee, whichever is better for them, unless the DM says", () => {
    const scouts = [unit({ creatureId: "scout", hp: 16, regionId: "c", status: "hidden" }), unit({ creatureId: "scout", hp: 16, regionId: "c", status: "hidden" })];
    const target = unit({ ownerTeamId: THEM, creatureId: "warrior-infantry", hp: 9, regionId: "c" });
    const w = world([...scouts, target]);
    const attack = order("attack", { "0": scouts.map((u) => u.id), "1": target.id });
    // Archers attacking unseen do better shooting as the defenders close in.
    const auto = resolve(w, attack).combats![0];
    expect(auto.surpriseStart).toEqual({ choice: "range", auto: true });
    expect(auto.approach!.rounds).toBeGreaterThan(0);
    expect(auto.log.some((e) => /starts at range, 150 ft away \(chosen as better for them/.test(e.text))).toBe(true);
    // The DM can make them close in unseen instead: no approach rounds.
    const input = { ruleset: r, world: w, teamId: ME, order: attack, round: 1, seed: "s", combat: { start: { "0": "melee" as const } } };
    const melee = resolveOrder(input).combats![0];
    expect(melee.surpriseStart).toEqual({ choice: "melee", auto: false });
    expect(melee.approach).toMatchObject({ startFt: 0, rangeFt: 150, rounds: 0 });
    // Odds use the same start.
    const odds = orderCombatOdds(input, 20);
    expect(odds[0].runs).toBe(20);
    expect(odds[0].rounds).toBeGreaterThan(0);
  });

  it("an open attack has no surprise choice", () => {
    const scouts = [unit({ creatureId: "scout", hp: 16, regionId: "c" })];
    const target = unit({ ownerTeamId: THEM, creatureId: "warrior-infantry", hp: 9, regionId: "c" });
    const res = resolve(world([...scouts, target]), order("attack", { "0": scouts.map((u) => u.id), "1": target.id })).combats![0];
    expect(res.surpriseStart).toBeUndefined();
    expect(res.approach!.startFt).toBe(150);
  });

  it("the DM can set a unit's result by hand", () => {
    const g = unit({ creatureId: "knight", hp: 52 });
    const lizard = unit({ ownerTeamId: null, creatureId: "giant-lizard", hp: 19, regionId: "b" });
    const w = world([g, lizard]);
    const p = resolveOrder({ ruleset: r, world: w, teamId: ME, order: order("move", { "0": [g.id], "1": [at("b")] }), round: 1, seed: "s", combat: { overrides: { [g.id]: { outcome: "retreated", hp: 5 } } } });
    const after = applyChanges(w, p.changes);
    const knight = after.units.find((u) => u.id === g.id)!;
    expect(knight.hp).toBe(5);
    expect(knight.regionId).toBe("a");
    expect(p.combats![0].log.at(-1)!.text).toMatch(/The DM set/);
  });

  it("can only attack a target in the same region", () => {
    const g = unit({ creatureId: "knight", hp: 52, regionId: "a" });
    const target = unit({ ownerTeamId: THEM, regionId: "c" });
    const p = resolve(world([g, target]), order("attack", { "0": [g.id], "1": target.id }));
    expect(p.status).toBe("invalid");
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

describe("stealth", () => {
  const scout = () => unit({ creatureId: "scout", archetypeId: "scout", hp: 16 });
  it("a stealthy move rolls against each side watching, ends hidden, and records who spotted it", () => {
    const sc = scout();
    const watcher = unit({ ownerTeamId: THEM, regionId: "b" });
    const w = world([sc, watcher]);
    const p = resolve(w, order("move-stealth", { "0": [sc.id], "1": [at("b")] }));
    expect(p.problems).toEqual([]);
    expect(p.rolls).toHaveLength(1);
    expect(p.rolls[0].breakdown).toMatch(/vs DC \d+ \(Guard's passive Perception\)/);
    const after = applyChanges(w, p.changes);
    expect(after.units.find((u) => u.id === sc.id)!.status).toBe("hidden");
    const spotted = p.rolls[0].outcome === "spotted";
    expect(after.detections?.[THEM]?.includes(sc.id) ?? false).toBe(spotted);
  });

  it("a watchtower sets the DC and gives disadvantage", () => {
    const w = world([]);
    w.regions[2].buildings = [{ buildingId: "watchtower", tier: 1 }];
    const list = watchers(r, w, "c", ME, () => "unit");
    expect(list).toEqual([{ observer: THEM, dc: 13, source: "a watchtower", disadvantage: true }]);
  });

  it("hidden monsters fight units that walk in, and are revealed", () => {
    const g = unit({ creatureId: "knight", hp: 52 });
    const lurker = unit({ ownerTeamId: null, creatureId: "giant-spider", hp: 26, regionId: "b", status: "hidden" });
    const w = world([g, lurker]);
    const p = resolve(w, order("move", { "0": [g.id], "1": [at("b")] }));
    expect(p.combats).toHaveLength(1);
    expect(p.rolls.some((x) => /lies in wait/.test(x.label))).toBe(true);
    const after = applyChanges(w, p.changes);
    expect(after.units.find((u) => u.id === lurker.id)!.status).not.toBe("hidden");
  });

  it("searching for hidden units can find them", () => {
    const searchers = [unit({ regionId: "c" }), unit({ regionId: "c" })];
    const spy = unit({ ownerTeamId: THEM, creatureId: "scout", regionId: "c", status: "hidden" });
    const w = world([...searchers, spy]);
    const p = resolve(w, order("explore", { "0": searchers.map((u) => u.id), "1": "Hidden units" }));
    expect(p.problems).toEqual([]);
    expect(p.rolls).toHaveLength(1);
    const found = p.rolls[0].outcome === "found";
    expect(p.changes.some((c) => c.type === "detectUnits" && c.unitIds.includes(spy.id))).toBe(found);
  });
});

describe("trades", () => {
  it("swaps resources, items and units when both sides can pay", () => {
    const g = unit({});
    const w = world([g]);
    w.inventory[THEM] = { metal: 2 };
    const res = executeTrade(r, w, { id: "t1", fromTeamId: ME, toTeamId: THEM, give: { ...EMPTY_BUNDLE, resources: { gold: 5 }, unitIds: [g.id] }, get: { ...EMPTY_BUNDLE, items: { metal: 2 }, map: true } });
    expect(res.ok).toBe(true);
    expect(res.changes.some((c) => c.type === "shareMap")).toBe(true);
    const after = applyChanges(w, res.changes.filter((c) => c.type !== "shareMap") as never);
    expect(after.teams[0].resources.gold).toBe(15);
    expect(after.teams[1].resources.gold).toBe(10);
    expect(after.inventory[ME].metal).toBe(2);
    expect(after.units[0].ownerTeamId).toBe(THEM);
    expect(res.summary).toMatch(/Me gave 5 Gold, a Guard; Them gave 2× Metal, a copy of its map/);
  });

  it("fails with a reason when a side no longer has what it offered", () => {
    const res = executeTrade(r, world([]), { id: "t2", fromTeamId: THEM, toTeamId: ME, give: { ...EMPTY_BUNDLE, resources: { gold: 50 } }, get: EMPTY_BUNDLE });
    expect(res.ok).toBe(false);
    expect(res.changes).toEqual([]);
    expect(res.problems[0]).toMatch(/Them doesn't have 50 Gold/);
  });

  it("runs accepted trades at the end of the round, after income", () => {
    const end = endOfRound(r, world([], { gold: 0, food: 5, growth: 0 }), "seed", {
      trades: [{ id: "t3", fromTeamId: ME, toTeamId: THEM, give: { ...EMPTY_BUNDLE, resources: { gold: 1 } }, get: EMPTY_BUNDLE }],
    });
    // The outpost's +1 Gold arrives first, so the trade can be paid.
    expect(end.trades[0].ok).toBe(true);
  });
});

describe("random events", () => {
  it("rolls the event table for the chosen teams, with +1 per 6 regions", () => {
    const w = world([]);
    const end = endOfRound(r, w, "seed", { events: { tableId: "turn-event", teamIds: [ME] } });
    const me = end.teams.find((t) => t.teamId === ME)!;
    expect(me.rolls.some((x) => x.tableId === "turn-event")).toBe(true);
    expect(me.lines.some((l) => l.startsWith("Event:"))).toBe(true);
    expect(end.teams.find((t) => t.teamId === THEM)!.rolls.some((x) => x.tableId === "turn-event")).toBe(false);
  });

  it("survivors join as a new race", () => {
    const res = rollOnTable(r, "race", createRng("r"));
    expect(res.results[0].type).toBe("gainRace");
  });
});

describe("roll tables", () => {
  it("chains into other tables", () => {
    // Search Ruin 21+ rolls on the Rare Treasure table, which gives an item.
    const res = rollOnTable(r, "search-ruin", createRng("x"), { modifiers: [{ label: "test", value: 30 }] });
    expect(res.rolls.map((x) => x.tableId)).toEqual(["search-ruin", "treasure-rare", ...res.rolls.slice(2).map((x) => x.tableId)]);
    expect(res.results.some((x) => x.type === "gainItem")).toBe(true);
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
      [2, ["a1", "a2", "a3", "b1"]],
      [4, ["a4", "a5"]],
    ]);
  });

  it("puts each team's moves in the move step before its next numbered action", () => {
    const moves = new Set(["a1", "a3", "a5", "b1", "b3"]);
    const isMove = (x: { id: string }) => moves.has(x.id);
    const q = buildQueue(
      [
        o("a1", "A", 0, "free", null), // move, then attack
        o("a2", "A", 1, "numbered", 1),
        o("a3", "A", 2, "free", null),
        o("a4", "A", 3, "numbered", 2),
        o("a5", "A", 4, "free", null), // after the last action
        // An old order: a move saved as numbered action 1. It doesn't count as an action.
        o("b1", "B", 0, "numbered", 1),
        o("b2", "B", 1, "numbered", 2),
        o("b3", "B", 2, "free", null),
      ],
      ["A", "B"],
      isMove,
    );
    expect(q.map((s) => [s.label, s.items.map((i) => i.id)])).toEqual([
      ["Moves before action 1", ["a1", "b1"]],
      ["Action 1", ["a2", "b2"]],
      ["Moves before action 2", ["a3", "b3"]],
      ["Action 2", ["a4"]],
      ["Moves after action 2", ["a5"]],
    ]);
    expect(q.map((s) => s.kind)).toEqual(["moves", "action", "moves", "action", "moves"]);
  });

  it("flags teams meeting in a region", () => {
    const g = unit({ regionId: "b" });
    const enemy = unit({ ownerTeamId: THEM, regionId: "c" });
    const w = world([g, enemy]);
    const mine = order("move", { "0": [g.id], "1": [at("c")] });
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
    // Gold has its own deficit table, with +1 per Gold short.
    const deficit = me.rolls.find((x) => x.tableId === "deficit-gold")!;
    expect(deficit.breakdown).toContain("4 Gold short 4");
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
