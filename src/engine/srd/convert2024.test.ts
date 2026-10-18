import { describe, expect, it } from "vitest";
import { srdByName, srdMonsters } from "./library";
import { deriveStats, attackBonus, saveDcValue } from "../ruleset/derive";

describe("bundled SRD 5.2 monsters", () => {
  it("includes all 341 monsters", () => {
    expect(srdMonsters()).toHaveLength(341);
  });

  it("reproduces every printed to-hit bonus and save DC it understood", () => {
    const mismatches: string[] = [];
    for (const m of srdMonsters()) {
      const stats = deriveStats(m.statBlock);
      for (const a of [...m.statBlock.actions, ...m.statBlock.bonusActions, ...m.statBlock.reactions]) {
        const printedHit = /Attack Roll: ([+−-]\d+)/.exec(a.text)?.[1];
        if (a.profile.kind === "attack" && printedHit) {
          const got = attackBonus(a, stats)!.total;
          if (got !== Number(printedHit.replace("−", "-"))) mismatches.push(`${m.name} ${a.name}: ${got} vs ${printedHit}`);
        }
        const printedDc = /Saving Throw: DC (\d+)/.exec(a.text)?.[1];
        if (a.profile.kind === "save" && printedDc) {
          const got = saveDcValue(a.profile.dc, stats);
          if (got !== Number(printedDc)) mismatches.push(`${m.name} ${a.name}: DC ${got} vs ${printedDc}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("parses breath weapons, areas and recharge", () => {
    const breath = srdByName("Adult Red Dragon").statBlock.actions.find((a) => a.name === "Fire Breath")!;
    expect(breath.uses).toEqual({ type: "recharge", min: 5 });
    expect(breath.profile).toMatchObject({ kind: "save", onSuccess: "half", area: { shape: "cone", size: 60 }, damage: [{ dice: "17d6", type: "fire" }] });
  });

  it("parses multiattack routines", () => {
    const medusa = srdByName("Medusa").statBlock.actions.find((a) => a.name === "Multiattack")!;
    expect(medusa.profile).toEqual({
      kind: "multiattack",
      options: [
        [{ action: "Claw", count: 2 }, { action: "Snake Hair", count: 1 }],
        [{ action: "Poison Ray", count: 3 }],
      ],
    });
  });

  it("parses conditions with durations", () => {
    const claw = srdByName("Ghoul").statBlock.actions.find((a) => a.name === "Claw")!;
    expect(claw.profile).toMatchObject({ kind: "attack", onHitCondition: { condition: "paralyzed", durationRounds: 1 } });
    expect(claw.review).toBe("needsReview");
  });

  it("parses spellcasting with per-day uses", () => {
    const sc = srdByName("Mage").statBlock.actions.find((a) => a.name === "Spellcasting")!;
    expect(sc.profile.kind).toBe("spellcasting");
    if (sc.profile.kind === "spellcasting") {
      expect(sc.profile.spells.find((s) => s.name === "Fireball")?.uses).toEqual({ type: "perDay", times: 2 });
    }
  });
});
