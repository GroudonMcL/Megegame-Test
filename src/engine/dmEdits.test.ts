import { describe, expect, it } from "vitest";
import {
  applyRecipeChange,
  inventoryDescription,
  inventoryNote,
  joinList,
  ordersNote,
  planInventoryEdit,
  planRecipeEdit,
  recipeDescription,
  recipeLabel,
  recipeNote,
  renameNote,
  staleKeys,
  tradeNote,
} from "./dmEdits";

const names: Record<string, string> = { iron: "Iron Ingot", rope: "Rope", sword: "Steel Sword", arrow: "Arrow" };
const name = (id: string) => names[id] ?? id;

describe("inventory edits", () => {
  it("keeps only the items that change, with what they were", () => {
    expect(planInventoryEdit({ iron: 1, rope: 3 }, { iron: 3, rope: 3, sword: 1 })).toEqual({ before: { iron: 1, sword: 0 }, after: { iron: 3, sword: 1 } });
  });

  it("removes an item by setting it to 0, and rounds and clamps what's typed", () => {
    expect(planInventoryEdit({ rope: 3 }, { rope: 0 })).toEqual({ before: { rope: 3 }, after: { rope: 0 } });
    expect(planInventoryEdit({}, { iron: 2.7, rope: -4 })).toEqual({ before: { iron: 0 }, after: { iron: 2 } });
    expect(planInventoryEdit({}, { iron: 5e9 })?.after.iron).toBe(1_000_000);
    expect(planInventoryEdit({}, { iron: Number.NaN })).toBeNull();
  });

  it("is null when nothing changes", () => {
    expect(planInventoryEdit({ iron: 2 }, { iron: 2 })).toBeNull();
    expect(planInventoryEdit({ iron: 2 }, {})).toBeNull();
  });

  it("suggests a note and a change-list line", () => {
    const change = planInventoryEdit({ rope: 3 }, { iron: 2, rope: 2 })!;
    expect(inventoryNote(change, name)).toBe("The DM gave you 2× Iron Ingot and took 1× Rope.");
    expect(inventoryDescription(change, name, "Iron Clan")).toBe("Gave Iron Clan 2× Iron Ingot; took 1× Rope");
    const taken = planInventoryEdit({ rope: 3, iron: 1 }, { rope: 0, iron: 0 })!;
    expect(inventoryNote(taken, name)).toBe("The DM took 3× Rope and 1× Iron Ingot.");
    expect(inventoryDescription(taken, name, "Iron Clan")).toBe("Took from Iron Clan 3× Rope and 1× Iron Ingot");
  });
});

describe("recipe edits", () => {
  const atStart = new Set(["arrow"]);

  it("teaches and forgets, but leaves recipes everyone knows from the start alone", () => {
    const change = planRecipeEdit(["rope"], { sword: true, rope: false, arrow: false }, atStart)!;
    expect(change).toEqual({ before: { sword: false, rope: true }, after: { sword: true, rope: false } });
    expect(applyRecipeChange(["rope", "iron"], change.after).sort()).toEqual(["iron", "sword"]);
    expect(applyRecipeChange(["iron", "sword"], change.before).sort()).toEqual(["iron", "rope"]);
  });

  it("is null when nothing changes", () => {
    expect(planRecipeEdit(["rope"], { rope: true, arrow: false }, atStart)).toBeNull();
  });

  it("suggests a note and a change-list line", () => {
    const change = planRecipeEdit(["rope"], { sword: true, iron: true, rope: false }, atStart)!;
    expect(recipeNote(change, name)).toBe("The DM taught you the recipes for Steel Sword and Iron Ingot. You forgot the recipe for Rope.");
    expect(recipeDescription(change, name, "Iron Clan")).toBe("Taught Iron Clan the recipes for Steel Sword and Iron Ingot; made it forget Rope");
    expect(recipeDescription(planRecipeEdit(["rope"], { rope: false }, atStart)!, name, "Iron Clan")).toBe("Made Iron Clan forget Rope");
  });

  it("names a recipe by what it makes", () => {
    expect(
      recipeLabel(
        {
          outputs: [
            { itemId: "arrow", qty: 20 },
            { itemId: "rope", qty: 1 },
          ],
        },
        name,
      ),
    ).toBe("20× Arrow + Rope");
  });
});

describe("undo safety", () => {
  it("lists what changed since the DM's change", () => {
    expect(staleKeys({ iron: 3, sword: 1 }, { iron: 3, sword: 1 }, 0)).toEqual([]);
    expect(staleKeys({ iron: 3, sword: 1 }, { iron: 2, sword: 1 }, 0)).toEqual(["iron"]);
    // An item that's gone counts as 0.
    expect(staleKeys({ rope: 0 }, {}, 0)).toEqual([]);
    expect(staleKeys({ rope: 2 }, {}, 0)).toEqual(["rope"]);
    expect(staleKeys({ sword: true }, { sword: false }, false)).toEqual(["sword"]);
  });
});

describe("suggested notes", () => {
  it("joins lists in plain English", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("covers renames, orders and trade steps", () => {
    expect(renameNote("Knight", "Sir Bors")).toBe("The DM renamed Knight to Sir Bors.");
    expect(renameNote("", "Sir Bors")).toBe("The DM named one of your units Sir Bors.");
    expect(renameNote("Sir Bors", "")).toBe("The DM cleared the name of Sir Bors.");
    expect(ordersNote(1, 3)).toBe("The DM changed your orders for round 3 (1 order).");
    expect(ordersNote(4, null)).toBe("The DM changed your orders (4 orders).");
    expect(tradeNote("accept", "Red Hand")).toBe("The DM accepted the trade from Red Hand for you.");
    expect(tradeNote("cancel", "Red Hand")).toBe("The DM called off your trade with Red Hand.");
  });
});
