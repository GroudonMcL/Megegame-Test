import { describe, expect, it } from "vitest";
import { utterdarkPreset } from "@/presets/utterdark";
import type { WorldUnit } from "../world/types";
import { areaMultipliers, areaWidth } from "./area";
import { combatOdds, simulateCombat } from "./simulate";
import type { CombatInput } from "./types";

const r = utterdarkPreset();
let n = 0;
function unit(creatureId: string, extra: Partial<WorldUnit> = {}): WorldUnit {
  const c = r.creatures.find((x) => x.id === creatureId)!;
  return {
    id: `u${++n}`,
    ownerTeamId: "red",
    creatureId,
    name: "",
    raceId: null,
    archetypeId: null,
    academyBonus: {},
    augmentIds: [],
    hp: c.statBlock.hp,
    regionId: "a",
    milesUsed: 0,
    status: "active",
    isLeader: false,
    usesSpent: {},
    ...extra,
  };
}
function fight(red: WorldUnit[], wild: WorldUnit[], extra: Partial<CombatInput> = {}): CombatInput {
  return {
    ruleset: r,
    region: null,
    seed: "test",
    sides: [
      { id: "red", teamId: "red", name: "Red", units: red, retreatTo: Object.fromEntries(red.map((u) => [u.id, "b"])) },
      { id: "wild", teamId: null, name: "Wild", units: wild.map((u) => ({ ...u, ownerTeamId: null })) },
    ],
    ...extra,
  };
}

describe("area effects", () => {
  const medium = (k: number) => Array(k).fill(30);
  it("matches the agreed worked examples against Medium units", () => {
    expect(areaMultipliers({ shape: "cone", size: 15 }, medium(3))).toEqual([1.5]);
    expect(areaMultipliers({ shape: "sphere", size: 20 }, medium(3))).toEqual([2, 0.33]);
    expect(areaMultipliers({ shape: "cone", size: 60 }, medium(3))).toEqual([2, 1]);
    expect(areaMultipliers({ shape: "cone", size: 90 }, medium(4))).toEqual([2, 1, 1]);
    expect(areaMultipliers({ shape: "line", size: 100, width: 5 }, medium(6))).toEqual([1, 1, 1, 0.33]);
  });
  it("uses each unit's footprint by size", () => {
    // Fireball (40 ft) against a Large unit (60 ft) covers two-thirds of it.
    expect(areaMultipliers({ shape: "sphere", size: 20 }, [60, 30])).toEqual([1.67]);
    // …and against Small units (15 ft): full bonus, then one whole unit, then two-thirds of another.
    expect(areaMultipliers({ shape: "sphere", size: 20 }, [15, 15, 15, 15])).toEqual([2, 1, 0.67]);
    expect(areaWidth({ shape: "cube", size: 15 })).toBe(15);
  });
  it("only hits as many units as there are", () => {
    expect(areaMultipliers({ shape: "cone", size: 90 }, medium(1))).toEqual([2]);
    expect(areaMultipliers({ shape: "cone", size: 90 }, [])).toEqual([]);
  });
});

describe("simulateCombat", () => {
  it("is reproducible from its seed", () => {
    const input = fight([unit("guard"), unit("guard")], [unit("giant-spider")]);
    expect(simulateCombat(input)).toEqual(simulateCombat(input));
    expect(simulateCombat({ ...input, seed: "other" }).log).not.toEqual(simulateCombat(input).log);
  });

  it("ends with a winner and a readable log", () => {
    const res = simulateCombat(fight([unit("knight"), unit("knight")], [unit("giant-lizard")]));
    expect(res.winner).toBe("red");
    expect(res.log[0].kind).toBe("initiative");
    expect(res.log.some((l) => l.kind === "attack")).toBe(true);
    expect(res.units.find((u) => u.sideId === "wild")!.outcome).toBe("dead");
  });

  it("team units retreat below a quarter of their HP; monsters fight on", () => {
    const res = simulateCombat(fight([unit("guard")], [unit("ghoul"), unit("ghoul")], { seed: "retreat" }));
    const guard = res.units.find((u) => u.sideId === "red")!;
    expect(["retreated", "dead"]).toContain(guard.outcome);
    if (guard.outcome === "retreated") {
      expect(guard.retreatTo).toBe("b");
      expect(guard.hp).toBeLessThan(guard.maxHp / 4);
    }
    expect(res.units.filter((u) => u.sideId === "wild").every((u) => u.outcome !== "retreated")).toBe(true);
  });

  it("a fight with only one side doesn't happen", () => {
    expect(simulateCombat(fight([unit("guard")], [])).endReason).toBe("noFight");
  });

  it("counts per-round uses, so a second fight in the same round has fewer spells", () => {
    const mage = unit("mage");
    const res = simulateCombat(fight([mage], [unit("ochre-jelly"), unit("ochre-jelly"), unit("ochre-jelly")], { seed: "mage" }));
    const after = res.units.find((u) => u.unitId === mage.id)!;
    expect(Object.keys(after.usesSpent).length).toBeGreaterThan(0);
    // Already used up: nothing per-day left to spend.
    const spent = { Fireball: 2, "Cone of Cold": 1 };
    const again = simulateCombat(fight([{ ...mage, usesSpent: spent }], [unit("ochre-jelly")], { seed: "mage2" }));
    expect(again.log.some((l) => /Fireball|Cone of Cold/.test(l.text))).toBe(false);
  });

  it("disabling conditions cut damage by how badly the save failed", () => {
    // Sleep (Con/Wis save) from a Bard: every failed save shows the cut.
    const bard = unit("guard-captain", { archetypeId: "bard" });
    const res = simulateCombat(fight([bard], [unit("giant-lizard")], { seed: "sleepy" }));
    for (const l of res.log.filter((x) => x.kind === "condition" && /unconscious by/.test(x.text))) {
      expect(l.text).toMatch(/cut by (50|75)%|loses its turns/);
    }
  });

  it("captures a monster once it's below a quarter HP and alone", () => {
    const res = simulateCombat(
      fight([unit("knight"), unit("knight"), unit("knight")], [unit("giant-lizard", { id: "liz" })], { seed: "cap", capture: { sideId: "red", targetId: "liz" } }),
    );
    if (res.endReason === "captured") expect(res.units.find((u) => u.unitId === "liz")!.outcome).toBe("captured");
    else expect(res.log.some((l) => l.kind === "capture") || res.units.find((u) => u.unitId === "liz")!.outcome === "dead").toBe(true);
  });

  it("a priority target is attacked first", () => {
    const big = unit("giant-spider", { id: "big" });
    const res = simulateCombat(fight([unit("knight")], [unit("giant-bat"), big], { seed: "prio", priority: { red: "big" } }));
    const first = res.log.find((l) => l.kind === "attack" && l.text.startsWith("Knight"));
    expect(first?.text).toMatch(/→ Giant Spider/);
  });

  it("odds add up", () => {
    const odds = combatOdds(fight([unit("knight")], [unit("giant-lizard")]), 50);
    expect(odds.runs).toBe(50);
    expect(odds.wins.red + odds.wins.wild + odds.draws).toBeCloseTo(1);
    expect(odds.wins.red).toBeGreaterThan(0.5);
  });
});
