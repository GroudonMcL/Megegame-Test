import { describe, expect, it } from "vitest";
import { utterdarkPreset } from "@/presets/utterdark";
import { equipBlocked, equipMax, equipProblems, isEquippable, mergeItems, unitItems, withEquipped, withUnequipped } from "./equipment";
import { unitBonuses } from "./ruleset/derive";
import { Ruleset } from "./ruleset/ruleset";
import type { WorldUnit } from "./world/types";

const r = utterdarkPreset();
const item = (id: string) => r.items.find((x) => x.id === id);

function unit(extra: Partial<WorldUnit> = {}): WorldUnit {
  return { id: "u1", ownerTeamId: "T", creatureId: "guard", name: "Ada", raceId: null, archetypeId: "regiment", academyBonus: {}, equippedItemIds: [], hp: 11, regionId: "a", x: null, y: null, milesUsed: 0, status: "active", isLeader: false, usesSpent: {}, ...extra };
}
const ctx = (inventory: Record<string, number>, teamUnits: WorldUnit[] = [], round = 2) => ({ inventory, teamUnits, round });

describe("equipping items", () => {
  it("only items in an equippable category can be equipped", () => {
    expect(isEquippable(r, item("plus1-armour"))).toBe(true);
    expect(isEquippable(r, item("aboleth-hide"))).toBe(false);
    expect(equipProblems(r, unit(), "aboleth-hide", ctx({ "aboleth-hide": 1 }))).toEqual(["Aboleth Hide can't be equipped."]);
  });

  it("needs the item in the inventory", () => {
    expect(equipProblems(r, unit(), "plus1-armour", ctx({ "plus1-armour": 1 }))).toEqual([]);
    expect(equipProblems(r, unit(), "plus1-armour", ctx({}))[0]).toMatch(/don't have/);
  });

  it("checks the item's unit tags and races", () => {
    // A Guard with no archetype isn't Martial.
    expect(equipProblems(r, unit({ archetypeId: null }), "plus1-armour", ctx({ "plus1-armour": 1 })).join(" ")).toMatch(/needs a Martial unit/);
    expect(equipProblems(r, unit({ raceId: "orc" }), "dwarven-plate", ctx({ "dwarven-plate": 1 })).join(" ")).toMatch(/only be used by Dwarf or Duergar units/);
    expect(equipProblems(r, unit({ raceId: "dwarf" }), "dwarven-plate", ctx({ "dwarven-plate": 1 })).join(" ")).not.toMatch(/only be used/);
  });

  it("respects the slot limit and the total per unit", () => {
    const armoured = unit({ equippedItemIds: ["plus1-armour"] });
    expect(equipProblems(r, armoured, "plus2-armour", ctx({ "plus2-armour": 1 })).join(" ")).toMatch(/Armour slot is full \(1 item\)/);
    const full = unit({ equippedItemIds: ["plus1-armour", "plus1-shields", "plus1-weapons"] });
    expect(equipProblems(r, full, "amulets-of-health", ctx({ "amulets-of-health": 1 })).join(" ")).toMatch(/at most 3 items/);
    // An Artificer can have 4 (equipLimit effect).
    expect(equipMax(r, unit({ archetypeId: "artificer" }))).toBe(4);
    expect(equipMax(r, full)).toBe(r.settings.maxEquippedPerUnit);
  });

  it("an item without a slot only counts towards the total", () => {
    const rules = Ruleset.parse({ ...r, items: [...r.items, { id: "lucky-coin", name: "Lucky Coin", categoryId: "augment" }] });
    const u = unit({ equippedItemIds: ["plus1-armour"] });
    expect(equipProblems(rules, u, "lucky-coin", ctx({ "lucky-coin": 2 }))).toEqual([]);
    expect(equipProblems(rules, withEquipped(u, "lucky-coin", 1) as WorldUnit, "lucky-coin", ctx({ "lucky-coin": 1 }))).toEqual([]);
  });

  it("swap lock: an item unequipped this round only goes back on the unit it came from", () => {
    expect(r.settings.equipSwapLock).toBe(true);
    const a = unit({ id: "a", equippedItemIds: ["plus1-armour"] });
    const b = unit({ id: "b" });
    const afterA = { ...a, ...withUnequipped(a, "plus1-armour", 2)! };
    expect(afterA.equippedItemIds).toEqual([]);
    expect(afterA.unequipped).toEqual({ round: 2, itemIds: ["plus1-armour"] });
    const team = [afterA, b];
    expect(equipProblems(r, b, "plus1-armour", ctx({ "plus1-armour": 1 }, team)).join(" ")).toMatch(/can only go back on that unit/);
    // Back on the same unit is fine (that's how a change is undone), and clears the lock.
    expect(equipProblems(r, afterA, "plus1-armour", ctx({ "plus1-armour": 1 }, team))).toEqual([]);
    expect(withEquipped(afterA, "plus1-armour", 2)).toEqual({ equippedItemIds: ["plus1-armour"], unequipped: null });
    // A second copy in the inventory is free to use; and next round the lock is gone.
    expect(equipProblems(r, b, "plus1-armour", ctx({ "plus1-armour": 2 }, team))).toEqual([]);
    expect(equipProblems(r, b, "plus1-armour", ctx({ "plus1-armour": 1 }, team, 3))).toEqual([]);
    // Without the setting there's no lock.
    const free = Ruleset.parse({ ...r, settings: { ...r.settings, equipSwapLock: false } });
    expect(equipProblems(free, b, "plus1-armour", ctx({ "plus1-armour": 1 }, team))).toEqual([]);
  });

  it("only while the round is open, for an active unit in a region the team owns", () => {
    const open = { open: true, reason: "" };
    expect(equipBlocked(unit(), { teamId: "T", roundOpen: open, regionOwner: "T" })).toBeNull();
    expect(equipBlocked(unit(), { teamId: "T", roundOpen: { open: false, reason: "Round 2 is locked." }, regionOwner: "T" })).toBe("Round 2 is locked.");
    expect(equipBlocked(unit(), { teamId: "T", roundOpen: open, regionOwner: "U" })).toMatch(/region you own/);
    expect(equipBlocked(unit({ status: "dead" }), { teamId: "T", roundOpen: open, regionOwner: "T" })).toMatch(/active units/);
    expect(equipBlocked(unit({ ownerTeamId: "U" }), { teamId: "T", roundOpen: open, regionOwner: "T" })).toMatch(/owner/);
  });

  it("equipped items change the unit's stats, each named as the bonus's source", () => {
    const bonuses = unitBonuses(r, unit({ equippedItemIds: ["plus1-armour"] }));
    expect(bonuses.find((b) => b.source === "+1 Armour")?.effects).toEqual(item("plus1-armour")!.effects);
  });

  it("adds up everything a unit has on it", () => {
    const u = unit({ equippedItemIds: ["plus1-armour", "plus1-armour"], carried: [{ itemId: "aboleth-hide", qty: 2 }, { itemId: "plus1-armour", qty: 1 }] });
    expect(unitItems(u)).toEqual([
      { itemId: "plus1-armour", qty: 3 },
      { itemId: "aboleth-hide", qty: 2 },
    ]);
    expect(mergeItems([[{ itemId: "x", qty: 0 }]])).toEqual([]);
  });
});

describe("rulesets from before augments became equipment", () => {
  it("are brought up to date without losing anything", () => {
    const old = {
      settings: { maxAugmentsPerUnit: 5 },
      itemCategories: [
        { id: "gear", name: "Gear" },
        { id: "junk", name: "Junk" },
      ],
      augmentSlots: [{ id: "ring", name: "Ring", maxPerUnit: 2 }],
      items: [
        { id: "ring-of-x", name: "Ring of X", categoryId: "gear", slotId: "ring" },
        { id: "rock", name: "Rock", categoryId: "junk" },
      ],
      archetypes: [{ id: "tinker", name: "Tinker", effects: [{ type: "augmentLimit", max: 4 }] }],
      actionTypes: [
        { id: "apply-augment", name: "Apply Augment", kind: "free", handler: "applyAugment" },
        { id: "noop", name: "Noop", kind: "free", handler: "manual" },
      ],
    };
    const parsed = Ruleset.parse(old);
    expect(parsed.settings.maxEquippedPerUnit).toBe(5);
    expect(parsed.equipSlots).toEqual([{ id: "ring", name: "Ring", maxPerUnit: 2 }]);
    expect(parsed.itemCategories.map((c) => c.equippable)).toEqual([true, false]);
    expect(parsed.archetypes[0].effects).toEqual([{ type: "equipLimit", max: 4 }]);
    expect(parsed.actionTypes.map((a) => a.id)).toEqual(["noop"]);
    expect("augmentSlots" in parsed).toBe(false);
    // The input isn't changed.
    expect(old.augmentSlots).toHaveLength(1);
  });

  it("the Utterdark preset has no Apply Augment order", () => {
    expect(r.actionTypes.some((a) => a.id === "apply-augment")).toBe(false);
    expect(r.equipSlots.length).toBeGreaterThan(0);
  });
});
