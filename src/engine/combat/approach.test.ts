import { describe, expect, it } from "vitest";
import { utterdarkPreset } from "@/presets/utterdark";
import type { Creature, Ruleset } from "../ruleset/ruleset";
import type { StatAction } from "../ruleset/statblock";
import type { WorldUnit } from "../world/types";
import { simulateCombat } from "./simulate";
import type { CombatInput, CombatResult } from "./types";

// Approach rounds: ranged units shoot while the sides close in, before round 1.

const base = utterdarkPreset();
const scout = base.creatures.find((c) => c.id === "scout")!;

const weapon = (name: string, attackType: "melee" | "ranged" | "meleeOrRanged", dice: string, range?: { normal: number; long?: number }): StatAction => ({
  name,
  text: "",
  uses: { type: "atWill" },
  review: "auto",
  profile: { kind: "attack", attackType, toHit: { ability: "dex", proficient: true, flat: 0 }, damage: [{ dice, ability: "dex", flat: 0, type: "piercing" }], ...(range ? { range } : {}) },
});

/** A test creature: a Scout's stats with the given speed, HP, AC and actions. */
function creature(id: string, speed: number, actions: StatAction[], extra: { hp?: number; ac?: number } = {}): Creature {
  return { ...scout, id, statBlock: { ...scout.statBlock, name: id, hp: extra.hp ?? 30, ac: extra.ac ?? 13, speed: { ...scout.statBlock.speed, walk: speed, fly: 0 }, actions, bonusActions: [], legendary: null, traits: [] } };
}

const archer = creature("Archer", 30, [weapon("Shortbow", "ranged", "1d6", { normal: 120, long: 480 }), weapon("Dagger", "melee", "1d4")], { hp: 200, ac: 30 });
const brute = creature("Brute", 30, [weapon("Club", "melee", "1d4")], { hp: 500, ac: 5 });
const runner = creature("Runner", 60, [weapon("Club", "melee", "1d4")], { hp: 500, ac: 5 });
const slinger = creature("Slinger", 30, [weapon("Sling", "ranged", "1d4", { normal: 30, long: 120 })], { hp: 500, ac: 5 });
const thrower = creature("Thrower", 30, [weapon("Dagger", "melee", "1d4"), weapon("Longbow", "ranged", "6d8", { normal: 150, long: 600 })], { hp: 500 });
const turret = creature("Turret", 0, [weapon("Longbow", "ranged", "1d4", { normal: 150, long: 600 })], { hp: 500 });
const knifer = creature("Knifer", 30, [weapon("Knife", "meleeOrRanged", "3d8", { normal: 20, long: 60 }), weapon("Longbow", "ranged", "3d8", { normal: 150, long: 600 })], { hp: 500 });

const r: Ruleset = { ...base, creatures: [...base.creatures, archer, brute, runner, slinger, thrower, turret, knifer] };
const withSettings = (combat: Partial<Ruleset["settings"]["combat"]>): Ruleset => ({ ...r, settings: { ...r.settings, combat: { ...r.settings.combat, ...combat } } });

let n = 0;
function unit(c: Creature, owner: string | null = "red"): WorldUnit {
  return { id: `${c.id}-${++n}`, ownerTeamId: owner, creatureId: c.id, name: "", raceId: null, archetypeId: null, academyBonus: {}, equippedItemIds: [], hp: c.statBlock.hp, regionId: "a", x: null, y: null, milesUsed: 0, status: "active", isLeader: false, usesSpent: {} };
}
function fight(red: Creature[], wild: Creature[], extra: Partial<CombatInput> = {}): CombatInput {
  return {
    ruleset: r,
    region: null,
    seed: "approach",
    sides: [
      { id: "red", teamId: "red", name: "Red", units: red.map((c) => unit(c)) },
      { id: "wild", teamId: null, name: "Wild", units: wild.map((c) => unit(c, null)) },
    ],
    ...extra,
  };
}
const attacksBy = (res: CombatResult, who: string, rounds: (n: number) => boolean) => res.log.filter((e) => e.kind === "attack" && e.text.startsWith(who) && rounds(e.round));
const heads = (res: CombatResult) => res.log.filter((e) => e.kind === "round").map((e) => e.text);

describe("approach rounds", () => {
  it("a 120 ft archer gets two extra rounds of attacks on a 30 ft melee unit", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const res = simulateCombat(fight([archer], [brute], { seed }));
      expect(res.approach).toMatchObject({ startFt: 120, rangeFt: 120, rounds: 2 });
      expect(heads(res).slice(0, 3)).toEqual(["Round −1 (distance 120 ft)", expect.stringMatching(/^Round 0 \(\d+ ft\)$/), "Round 1"]);
      // One attack in each approach round, the first from 120 ft with the bow.
      expect(attacksBy(res, "Archer", (k) => k === -1)).toHaveLength(1);
      expect(attacksBy(res, "Archer", (k) => k === 0)).toHaveLength(1);
      expect(attacksBy(res, "Archer", (k) => k === -1)[0].text).toMatch(/Shortbow/);
      // The brute dashes and can't attack until it's next to the archer.
      expect(attacksBy(res, "Brute", (k) => k === -1)).toHaveLength(0);
      expect(res.log.some((e) => e.round === -1 && e.kind === "move" && /Brute .* dashes 60 ft/.test(e.text))).toBe(true);
    }
  });

  it("the initiative and start lines are logged before the first approach round", () => {
    const res = simulateCombat(fight([archer], [brute]));
    const first = res.log.findIndex((e) => e.kind === "round");
    expect(res.log.slice(0, first).map((e) => e.kind)).toEqual(["initiative", "info"]);
    expect(res.log[1].text).toMatch(/start 120 ft apart/);
    expect(res.log.every((e) => e.round >= -1)).toBe(true);
  });

  it("fast units arrive first", () => {
    const res = simulateCombat(fight([archer], [brute, runner]));
    const reached = res.log.filter((e) => e.kind === "move" && /reaches/.test(e.text)).map((e) => e.text.split(" ")[0]);
    expect(reached[0]).toBe("Runner");
    expect(heads(res)[1]).toMatch(/Round 0 \(\d+ ft\)|Round 0 \(\d+–\d+ ft\)/);
  });

  it("caps the starting distance", () => {
    const res = simulateCombat(fight([archer], [brute], { ruleset: withSettings({ maxStartFt: 60 }) }));
    expect(res.approach).toMatchObject({ startFt: 60, rangeFt: 60, rounds: 1 });
    expect(res.log[1].text).toMatch(/longest normal range in the fight is 120 ft, but fights start at most 60 ft apart/);
  });

  it("no ranged attacks, no approach", () => {
    const res = simulateCombat(fight([brute], [runner]));
    expect(res.approach).toMatchObject({ startFt: 0, rounds: 0 });
    expect(heads(res)[0]).toBe("Round 1");
    expect(res.log.some((e) => e.kind === "move")).toBe(false);
  });

  it("beyond normal range is disadvantage, beyond long range can't be done", () => {
    // The turret's longbow sets 150 ft; the slinger (30/120) must walk 30 ft before it can shoot, at disadvantage.
    const res = simulateCombat(fight([slinger], [turret]));
    expect(res.approach!.startFt).toBe(150);
    const first = attacksBy(res, "Slinger", () => true)[0];
    expect(first.round).toBeLessThanOrEqual(0);
    expect(first.text).toMatch(/Sling \d+\/\d+ dis/);
    const firstMove = res.log.findIndex((e) => e.kind === "move" && e.text.startsWith("Slinger"));
    expect(firstMove).toBeLessThan(res.log.indexOf(first));
    expect(res.log[firstMove].text).toMatch(/moves 30 ft/);
  });

  it("in melee, a unit weighs its melee attack against its ranged attack at disadvantage", () => {
    const melee = withSettings({ maxStartFt: 0 });
    // Longbow 6d8 at disadvantage beats a 1d4 dagger.
    const res = simulateCombat(fight([thrower], [brute], { ruleset: melee }));
    const shots = attacksBy(res, "Thrower", () => true);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((e) => /Longbow \d+\/\d+ dis/.test(e.text))).toBe(true);
    // A melee-or-ranged knife is used in melee without disadvantage, rather than the longbow at disadvantage.
    const res2 = simulateCombat(fight([knifer], [brute], { ruleset: melee }));
    const stabs = attacksBy(res2, "Knifer", () => true);
    expect(stabs.every((e) => /Knife \d+[+-]/.test(e.text))).toBe(true);
  });

  it("a hidden attacker can skip the approach and start in melee", () => {
    const sides = (red: Creature[], wild: Creature[]) => {
      const f = fight(red, wild);
      f.sides[0].surprising = true;
      return f;
    };
    const res = simulateCombat({ ...sides([brute], [archer]), start: "melee" });
    expect(res.approach).toMatchObject({ startFt: 0, rangeFt: 120, rounds: 0 });
    expect(heads(res)[0]).toBe("Round 1");
    expect(res.log.some((e) => /closes in unseen and starts in melee/.test(e.text))).toBe(true);
    // …or open fire from range: the surprised make no attacks until the sides meet.
    const ranged = simulateCombat({ ...sides([archer], [thrower]), start: "range" });
    expect(ranged.approach!.rounds).toBeGreaterThan(0);
    expect(attacksBy(ranged, "Archer", (k) => k <= 0).length).toBeGreaterThan(0);
    expect(attacksBy(ranged, "Thrower", (k) => k <= 0).filter((e) => !/Dagger|dis/.test(e.text))).toHaveLength(0);
    // The surprised still close in.
    expect(ranged.log.some((e) => e.round <= 0 && e.kind === "move" && e.text.startsWith("Thrower"))).toBe(true);
  });

  it("surprised defenders make no attacks while the sides close in", () => {
    const f = fight([brute, runner], [archer], { start: "range" });
    f.sides[0].surprising = true;
    const res = simulateCombat(f);
    expect(res.approach!.rounds).toBeGreaterThan(0);
    // The archer could shoot from 120 ft, but doesn't until round 1, even once the runner has reached it.
    expect(attacksBy(res, "Archer", (k) => k <= 0)).toHaveLength(0);
    expect(res.log.some((e) => e.round <= 0 && /Archer .* caught by surprise/.test(e.text))).toBe(true);
    expect(attacksBy(res, "Runner", (k) => k <= 0).length).toBeGreaterThan(0);
    expect(attacksBy(res, "Archer", (k) => k === 1).length).toBeGreaterThan(0);
  });

  it("the same seed gives the same fight", () => {
    expect(simulateCombat(fight([archer], [brute, runner])).log).toEqual(simulateCombat(fight([archer], [brute, runner])).log);
  });
});
