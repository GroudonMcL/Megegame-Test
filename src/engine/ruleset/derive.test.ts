import { describe, expect, it } from "vitest";
import { srdByName } from "../srd/library";
import { utterdarkPreset } from "@/presets/utterdark";
import { attackBonus, damageText, deriveStats, saveDcValue, unitBonuses, unitTags } from "./derive";

describe("deriveStats", () => {
  const veteran = srdByName("Warrior Veteran").statBlock; // STR 16, CR 3, Greatsword +5, 2d6+3
  const greatsword = veteran.actions.find((a) => a.name === "Greatsword")!;

  it("matches the printed stat block with no bonuses", () => {
    const s = deriveStats(veteran);
    expect(s.ac.total).toBe(17);
    expect(s.maxHp.total).toBe(65);
    expect(attackBonus(greatsword, s)!.total).toBe(5);
    expect(damageText(greatsword, s)).toBe("2d6 + 3 slashing");
  });

  it("flows a race's STR bonus into to-hit and damage", () => {
    const s = deriveStats(veteran, [{ source: "Hardy folk", abilities: { str: 2, con: 2 } }]);
    expect(s.abilities.str.total).toBe(18);
    expect(attackBonus(greatsword, s)!.total).toBe(6);
    expect(damageText(greatsword, s)).toBe("2d6 + 4 slashing");
    // CON 14 → 16 raises the modifier by 1 across 10 hit dice.
    expect(s.maxHp.total).toBe(75);
  });

  it("adds equipment and fortification modifiers with a breakdown", () => {
    const s = deriveStats(veteran, [
      { source: "Chain Shirt", effects: [{ type: "modifier", target: "ac", value: 1, when: [] }] },
      { source: "Fortification", effects: [{ type: "modifier", target: "toHit", value: 2, when: [] }] },
    ]);
    expect(s.ac).toEqual({ total: 18, parts: [{ label: "Base", value: 17 }, { label: "Chain Shirt", value: 1 }] });
    expect(attackBonus(greatsword, s)!.parts.map((p) => p.label)).toContain("Fortification");
  });

  it("leaves conditional effects for the combat engine", () => {
    const s = deriveStats(veteran, [
      { source: "Rally", effects: [{ type: "modifier", target: "toHit", value: 1, when: [{ when: "firstRound" }] }] },
    ]);
    expect(s.toHitBonus).toEqual([]);
    expect(s.otherEffects).toHaveLength(1);
  });

  it("computes passive Perception and save DCs", () => {
    const dragon = srdByName("Adult Red Dragon").statBlock;
    const s = deriveStats(dragon);
    expect(s.passivePerception.total).toBe(23);
    const breath = dragon.actions.find((a) => a.name === "Fire Breath")!;
    if (breath.profile.kind !== "save") throw new Error("expected a save");
    expect(saveDcValue(breath.profile.dc, s)).toBe(21);
  });
});

describe("unit loadouts", () => {
  it("layer race, archetype, academy and equipped items onto the stat block", () => {
    const r = utterdarkPreset();
    const creature = r.creatures.find((c) => c.id === "warrior-veteran")!;
    const bonuses = unitBonuses(r, { raceId: "orc", archetypeId: "regiment", academyBonus: { str: 2 }, equippedItemIds: ["plus1-armour"] });
    expect(bonuses.map((b) => b.source)).toEqual(["Orc", "Regiment", "Academy", "+1 Armour"]);
    const s = deriveStats(creature.statBlock, bonuses);
    expect(s.abilities.str.total).toBe(20); // 16 + 2 (Orc) + 2 (Academy)
    expect(s.ac.total).toBe(18);
    // Martial Advantage is conditional, so it waits for the combat engine.
    expect(s.otherEffects.some((o) => o.source === "Regiment")).toBe(true);
    expect(unitTags(r, creature, "regiment")).toEqual(["Humanoid", "Regiment", "Martial"]);
  });
});
