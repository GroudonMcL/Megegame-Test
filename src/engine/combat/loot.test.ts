import { describe, expect, it } from "vitest";
import { utterdarkPreset } from "@/presets/utterdark";
import { applyChanges } from "../resolve/apply";
import { resolveOrder } from "../resolve/resolveOrder";
import type { World } from "../resolve/types";
import type { WorldRegion, WorldUnit } from "../world/types";
import { fightChanges, fightLoot, fightSummary, lootSentence, winningTeams } from "./fight";
import type { CombatResult, CombatUnitResult } from "./types";

const r = utterdarkPreset();
const ME = "team-me";
const PAL = "team-pal";
const itemName = (id: string) => r.items.find((x) => x.id === id)?.name ?? id;

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function unit(extra: Partial<WorldUnit>): WorldUnit {
  return { id: uid(), ownerTeamId: ME, creatureId: "knight", name: "", raceId: null, archetypeId: null, academyBonus: {}, equippedItemIds: [], hp: 52, regionId: "a", x: null, y: null, milesUsed: 0, status: "active", isLeader: false, usesSpent: {}, ...extra };
}
function region(id: string, x: number): WorldRegion {
  const poly: [number, number][] = [
    [x, 0],
    [x + 0.5, 0],
    [x + 0.5, 0.5],
    [x, 0.5],
  ];
  return { id, code: id.toUpperCase(), name: "", description: "", x: x + 0.25, y: 0.25, polygon: poly, settleable: true, hidden: false, ownerTeamId: null, settlementTierId: null, buildings: [], structures: [], deposits: [], features: [] };
}
function world(units: WorldUnit[]): World {
  return {
    regions: [region("a", 0), region("b", 0.5)],
    connections: [{ id: "a-b", regionA: "a", regionB: "b", kind: "border", blocked: false, miles: null, terrainId: "normal", hidden: false }],
    units,
    teams: [
      { id: ME, name: "Me", colour: "#00f", isNpc: false, resources: { gold: 20 }, baseRaceId: null, raceIds: [], knownRecipeIds: [] },
      { id: PAL, name: "Pal", colour: "#0f0", isNpc: false, resources: {}, baseRaceId: null, raceIds: [], knownRecipeIds: [] },
    ],
    inventory: {},
    map: { aspect: 1, milesAcross: 24 },
  };
}

/** A finished fight: side "me" (ME's and maybe PAL's units) against the wild. */
function result(units: { u: WorldUnit; sideId: string; outcome: CombatUnitResult["outcome"] }[], winner: string | null): CombatResult {
  return {
    seed: "s",
    regionId: "a",
    sides: [
      { id: ME, teamId: ME, name: "Me" },
      { id: "wild", teamId: null, name: "Wild monsters" },
    ],
    rounds: 3,
    winner,
    endReason: "wipedOut",
    log: [],
    warnings: [],
    units: units.map(({ u, sideId, outcome }) => ({ unitId: u.id, sideId, label: "Unit", startHp: u.hp, hp: outcome === "dead" ? 0 : u.hp, maxHp: u.hp, outcome, retreatTo: null, damageDealt: 0, damageTaken: 0, usesSpent: {} })),
  };
}

describe("loot from fights", () => {
  const hoard = () => unit({ ownerTeamId: null, creatureId: "giant-lizard", hp: 19, equippedItemIds: ["plus1-armour"], carried: [{ itemId: "aboleth-hide", qty: 3 }] });

  it("goes to the one winning team, and the fallen lose it", () => {
    const mine = unit({});
    const monster = hoard();
    const w = world([mine, monster]);
    const res = result(
      [
        { u: mine, sideId: ME, outcome: "standing" },
        { u: monster, sideId: "wild", outcome: "dead" },
      ],
      ME,
    );
    res.loot = fightLoot(r, w, res);
    expect(res.loot).toMatchObject({ mode: "auto", teamIds: [ME], items: [{ itemId: "plus1-armour", qty: 1 }, { itemId: "aboleth-hide", qty: 3 }] });
    const after = applyChanges(w, fightChanges(r, w, res));
    expect(after.inventory[ME]).toEqual({ "plus1-armour": 1, "aboleth-hide": 3 });
    const corpse = after.units.find((u) => u.id === monster.id)!;
    expect(corpse.status).toBe("dead");
    expect(corpse.equippedItemIds).toEqual([]);
    expect(corpse.carried).toEqual([]);
    expect(fightSummary(w, res, ME, r)).toMatch(/You took as loot: \+1 Armour, 3× Aboleth Hide\./);
  });

  it("the team's own fallen units' gear goes to the winners too", () => {
    const fallen = unit({ equippedItemIds: ["plus1-shields"] });
    const survivor = unit({});
    const monster = unit({ ownerTeamId: null, creatureId: "giant-lizard" });
    const w = world([fallen, survivor, monster]);
    const res = result(
      [
        { u: fallen, sideId: ME, outcome: "dead" },
        { u: survivor, sideId: ME, outcome: "standing" },
        { u: monster, sideId: "wild", outcome: "dead" },
      ],
      ME,
    );
    res.loot = fightLoot(r, w, res);
    expect(res.loot?.shares).toEqual({ [ME]: [{ itemId: "plus1-shields", qty: 1 }] });
  });

  it("stays on the fallen when the monsters win or nobody does", () => {
    const fallen = unit({ equippedItemIds: ["plus1-shields"] });
    const monster = unit({ ownerTeamId: null, creatureId: "giant-lizard" });
    const w = world([fallen, monster]);
    for (const winner of ["wild", null]) {
      const res = result(
        [
          { u: fallen, sideId: ME, outcome: "dead" },
          { u: monster, sideId: "wild", outcome: winner ? "standing" : "dead" },
        ],
        winner,
      );
      res.loot = fightLoot(r, w, res);
      expect(res.loot?.mode).toBe("corpse");
      const after = applyChanges(w, fightChanges(r, w, res));
      expect(after.units.find((u) => u.id === fallen.id)?.equippedItemIds).toEqual(["plus1-shields"]);
      expect(after.inventory[ME]).toBeUndefined();
      expect(lootSentence(w, res.loot, ME, itemName)).toBe("");
    }
  });

  describe("with several winning teams (a lent unit fought)", () => {
    const setup = () => {
      const mine = unit({});
      const lent = unit({ ownerTeamId: PAL, lentToTeamId: ME });
      const monster = hoard();
      const w = world([mine, lent, monster]);
      const res = result(
        [
          { u: mine, sideId: ME, outcome: "standing" },
          { u: lent, sideId: ME, outcome: "standing" },
          { u: monster, sideId: "wild", outcome: "dead" },
        ],
        ME,
      );
      return { w, res, mine, lent };
    };

    it("counts only teams with a unit still standing", () => {
      const { w, res, lent } = setup();
      expect(winningTeams(w, res)).toEqual([ME, PAL]);
      res.units.find((u) => u.unitId === lent.id)!.outcome = "retreated";
      expect(winningTeams(w, res)).toEqual([ME]);
    });

    it("until the DM splits it, it all goes to the ordering team", () => {
      const { w, res } = setup();
      res.loot = fightLoot(r, w, res);
      expect(res.loot).toMatchObject({ mode: "split", teamIds: [ME, PAL], shares: { [ME]: res.loot!.items } });
      expect(res.loot?.splitReset).toBe(false);
    });

    it("the DM's split goes into each team's inventory", () => {
      const { w, res } = setup();
      res.loot = fightLoot(r, w, res, {
        mode: "split",
        shares: {
          [ME]: [{ itemId: "aboleth-hide", qty: 2 }],
          [PAL]: [
            { itemId: "aboleth-hide", qty: 1 },
            { itemId: "plus1-armour", qty: 1 },
          ],
        },
      });
      const after = applyChanges(w, fightChanges(r, w, res));
      expect(after.inventory[ME]).toEqual({ "aboleth-hide": 2 });
      expect(after.inventory[PAL]).toEqual({ "aboleth-hide": 1, "plus1-armour": 1 });
      expect(lootSentence(w, res.loot, PAL, itemName)).toBe("You took as loot: Aboleth Hide, +1 Armour. Me took 2× Aboleth Hide.");
    });

    it("a split that doesn't add up (the fight changed) is reset", () => {
      const { w, res } = setup();
      res.loot = fightLoot(r, w, res, { mode: "split", shares: { [PAL]: [{ itemId: "aboleth-hide", qty: 9 }] } });
      expect(res.loot).toMatchObject({ mode: "split", splitReset: true, shares: { [ME]: res.loot!.items } });
    });

    it("or the DM sends the teams a note, and nobody's inventory changes", () => {
      const { w, res } = setup();
      res.loot = fightLoot(r, w, res, { mode: "note" });
      expect(res.loot?.mode).toBe("note");
      expect(res.loot?.note).toBe("Loot from the fight in A, for Me and Pal to share out between you: +1 Armour, 3× Aboleth Hide. Agree how to split it and tell the DM.");
      const changes = fightChanges(r, w, res);
      expect(changes.filter((c) => c.type === "inventory")).toEqual([]);
      // It's no longer on the corpse: it's the teams' to share out.
      const after = applyChanges(w, changes);
      expect(after.units.find((u) => u.carried?.length)).toBeUndefined();
      expect(lootSentence(w, res.loot, PAL, itemName)).toMatch(/^Loot to share out with Me: .*The DM has sent you a note/);
    });
  });
});

describe("loot when resolving an order", () => {
  it("an attack on a monster with a hoard: logged, in the results, and into the inventory", () => {
    const knights = [unit({}), unit({})];
    const monster = unit({ ownerTeamId: null, creatureId: "giant-lizard", hp: 19, carried: [{ itemId: "aboleth-hide", qty: 2 }] });
    const w = world([...knights, monster]);
    const p = resolveOrder({ ruleset: r, world: w, teamId: ME, order: { id: uid(), kind: "numbered", actionTypeId: "attack", inputs: { "0": knights.map((k) => k.id), "1": monster.id }, notes: "" }, round: 1, seed: "loot" });
    const fight = p.combats?.[0];
    expect(fight?.winner).toBe(ME);
    expect(fight?.log.find((l) => l.kind === "loot")?.text).toBe("Loot: Me takes 2× Aboleth Hide.");
    expect(p.text).toMatch(/You took as loot: 2× Aboleth Hide\./);
    expect(applyChanges(w, p.changes).inventory[ME]).toEqual({ "aboleth-hide": 2 });
  });

  it("a lent unit's owner shares the win: the DM is asked to split, then each team is told", () => {
    const mine = unit({});
    const lent = unit({ ownerTeamId: PAL, lentToTeamId: ME });
    const monster = unit({ ownerTeamId: null, creatureId: "giant-lizard", hp: 19, regionId: "b", carried: [{ itemId: "aboleth-hide", qty: 2 }] });
    const w = world([mine, lent, monster]);
    const order = { id: uid(), kind: "free" as const, actionTypeId: "move", inputs: { "0": [mine.id, lent.id], "1": [[0.75, 0.25]] }, notes: "" };
    const first = resolveOrder({ ruleset: r, world: w, teamId: ME, order, round: 1, seed: "lent" });
    expect(first.combats?.[0].loot?.teamIds).toEqual([ME, PAL]);
    expect(first.notes.join(" ")).toMatch(/split the loot/);
    const split = { "0": { mode: "split" as const, shares: { [ME]: [{ itemId: "aboleth-hide", qty: 1 }], [PAL]: [{ itemId: "aboleth-hide", qty: 1 }] } } };
    const p = resolveOrder({ ruleset: r, world: w, teamId: ME, order, round: 1, seed: "lent", combat: { loot: split } });
    const after = applyChanges(w, p.changes);
    expect(after.inventory[ME]).toEqual({ "aboleth-hide": 1 });
    expect(after.inventory[PAL]).toEqual({ "aboleth-hide": 1 });
    expect(p.reports?.find((x) => x.teamId === PAL)?.text).toMatch(/fought alongside Me .*You took as loot: Aboleth Hide/);
    // Or a note: queued for the teams' Messages, and no inventory change.
    const noted = resolveOrder({ ruleset: r, world: w, teamId: ME, order, round: 1, seed: "lent", combat: { loot: { "0": { mode: "note", text: "Share it nicely." } } } });
    expect(noted.teamNotes).toEqual([
      { teamId: ME, text: "Share it nicely." },
      { teamId: PAL, text: "Share it nicely." },
    ]);
    expect(applyChanges(w, noted.changes).inventory[ME]).toBeUndefined();
  });
});
