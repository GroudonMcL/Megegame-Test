import { describe, expect, it } from "vitest";
import { utterdarkPreset } from "@/presets/utterdark";
import { blankPreset } from "@/presets/blank";
import { Ruleset, emptyRuleset } from "./ruleset";
import { findReferenceProblems, parseRuleset } from "./validate";
import { describeEffect, Effect } from "./effects";
import { creatureCosts } from "./derive";

describe("rulesets", () => {
  it("an empty object becomes a valid empty ruleset", () => {
    const r = emptyRuleset();
    expect(r.settings.actionSlots).toBe(6);
    expect(r.resources).toEqual([]);
  });

  it("presets are valid and have no broken references", () => {
    for (const r of [blankPreset(), utterdarkPreset()]) {
      expect(findReferenceProblems(r)).toEqual([]);
    }
  });

  it("survives a JSON export and import unchanged", () => {
    const r = utterdarkPreset();
    const again = Ruleset.parse(JSON.parse(JSON.stringify(r)));
    expect(again).toEqual(r);
  });

  it("explains schema problems with readable paths", () => {
    const r = JSON.parse(JSON.stringify(utterdarkPreset()));
    r.buildings.find((b: { id: string }) => b.id === "farm").tiers[1].cost.gold = "lots";
    const result = parseRuleset(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].path).toBe("buildings › farm › tiers › 2 › cost › gold");
  });

  it("finds broken references and duplicate IDs", () => {
    const r = utterdarkPreset();
    r.recipes.push({ id: "bad", inputs: [{ itemId: "unobtainium", qty: 1 }], resources: {}, outputs: [{ itemId: "metal", qty: 1 }], knownAtStart: false });
    r.resources.push({ ...r.resources[0] });
    const problems = findReferenceProblems(r);
    expect(problems).toContainEqual({ path: "recipes › bad", message: 'Refers to item "unobtainium", which doesn\'t exist.' });
    expect(problems).toContainEqual({ path: "resources › gold", message: 'The ID "gold" is used more than once.' });
  });

  it("costs come from the CR table unless overridden", () => {
    const r = utterdarkPreset();
    const byId = (id: string) => r.creatures.find((c) => c.id === id)!;
    expect(creatureCosts(byId("guard"), r).cost).toEqual({ gold: 2, growth: 5 }); // CR 1/8
    expect(creatureCosts(byId("regiment"), r).upkeep).toEqual({ gold: 4, food: 1 }); // CR 3
    expect(creatureCosts(byId("assassin"), r).cost).toEqual({ gold: 20 }); // hero, CR 8
    expect(creatureCosts(byId("zombie"), r).upkeep).toEqual({}); // override
  });
});

describe("describeEffect", () => {
  const d = (e: unknown) => describeEffect(Effect.parse(e));
  it("reads naturally", () => {
    expect(d({ type: "modifier", target: "ac", value: 1, tagMultiplier: { tag: "Defender", factor: 2 } })).toBe("+1 AC (×2 for Defender units)");
    expect(d({ type: "advantage", mode: "advantage", on: "attacks", when: [{ when: "firstRound" }, { when: "alliesOutnumber" }] })).toBe(
      "Advantage on attacks in the first round of combat and when allies outnumber enemies",
    );
    expect(d({ type: "stealthDc", dc: 15, enemyDisadvantage: true, adjacentDc: 13 })).toBe(
      "Stealth DC 15 in this region; enemies have disadvantage on Stealth; stealthed units in adjacent regions must beat DC 13",
    );
    expect(d({ type: "exchange", rates: [{ give: { gold: 4 }, get: { food: 1 } }] })).toBe("Exchange: 4 gold → 1 food");
  });
});
