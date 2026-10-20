import { unitEffects } from "./orders/economy";
import { unitTags } from "./ruleset/derive";
import type { Ruleset } from "./ruleset/ruleset";
import { ACTIVE_STATUSES, type ItemQty, type WorldUnit } from "./world/types";

// Equipping items on units. An item can be equipped if its category is
// equippable; it may also take a slot (Armour, Shield…). Equipping takes the
// item out of the team's inventory and unequipping puts it back, straight
// away, while the round is open and the unit stands in a region the team
// owns. No database code here; src/lib/equipment.ts uses it.

type Item = Ruleset["items"][number];

/** Can items of this kind be equipped at all? */
export function isEquippable(r: Ruleset, item: Item | undefined): item is Item {
  return Boolean(item && r.itemCategories.find((c) => c.id === item.categoryId)?.equippable);
}

/** How many items this unit can have equipped: an equipLimit effect (the highest), else the game setting. */
export function equipMax(r: Ruleset, u: WorldUnit): number {
  const limits = unitEffects(r, u).flatMap((e) => (e.type === "equipLimit" ? [e.max] : []));
  return limits.length ? Math.max(...limits) : r.settings.maxEquippedPerUnit;
}

/** Why the team can't change this unit's equipment right now (null = it can). */
export function equipBlocked(
  u: WorldUnit,
  ctx: {
    teamId: string;
    roundOpen: { open: boolean; reason: string };
    regionOwner: string | null | undefined;
  },
): string | null {
  if (u.ownerTeamId !== ctx.teamId) return "Only the unit's owner can change its equipment.";
  if (!ctx.roundOpen.open) return ctx.roundOpen.reason || "The round isn't open.";
  if (!ACTIVE_STATUSES.has(u.status)) return "Only active units can change their equipment.";
  if (!u.regionId || ctx.regionOwner !== ctx.teamId) return "The unit must be in a region you own to change its equipment.";
  return null;
}

/** The unit's unequipped list, if it is from this round. */
function unequippedNow(u: WorldUnit, round: number): string[] {
  return u.unequipped && u.unequipped.round === round ? u.unequipped.itemIds : [];
}

/**
 * Copies of an item in the inventory that only another unit may take back
 * (with equipSwapLock: unequipped from it this round).
 */
export function lockedForOthers(r: Ruleset, unitId: string, itemId: string, teamUnits: WorldUnit[], round: number): number {
  if (!r.settings.equipSwapLock) return 0;
  return teamUnits.filter((v) => v.id !== unitId).reduce((n, v) => n + unequippedNow(v, round).filter((id) => id === itemId).length, 0);
}

export interface EquipCheck {
  inventory: Record<string, number>;
  /** All the team's units (for the swap lock). */
  teamUnits: WorldUnit[];
  round: number;
}

/** What stops this unit equipping this item, as sentences for the team. Empty = it can. */
export function equipProblems(r: Ruleset, u: WorldUnit, itemId: string, ctx: EquipCheck): string[] {
  const item = r.items.find((x) => x.id === itemId);
  if (!isEquippable(r, item)) return [`${r.items.find((x) => x.id === itemId)?.name ?? "That item"} can't be equipped.`];
  const problems: string[] = [];
  const unitName = u.name || r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name || "This unit";
  const have = ctx.inventory[item.id] ?? 0;
  const locked = lockedForOthers(r, u.id, item.id, ctx.teamUnits, ctx.round);
  if (have <= 0) problems.push(`You don't have a ${item.name}.`);
  else if (have - locked <= 0) problems.push(`Your ${item.name} was unequipped from another unit this round; it can only go back on that unit until next round.`);
  const creature = r.creatures.find((c) => c.id === u.creatureId);
  const tags = creature ? unitTags(r, creature, u.archetypeId) : [];
  for (const t of item.requiresUnitTags) if (!tags.includes(t)) problems.push(`${item.name} needs a ${t} unit.`);
  if (item.requiresRaces.length && !item.requiresRaces.includes(u.raceId ?? "")) {
    const races = item.requiresRaces.map((id) => r.races.find((x) => x.id === id)?.name ?? id).join(" or ");
    problems.push(`${item.name} can only be used by ${races} units.`);
  }
  const max = equipMax(r, u);
  if (u.equippedItemIds.length + 1 > max) problems.push(`${unitName} can have at most ${max} item${max === 1 ? "" : "s"} equipped.`);
  const slot = r.equipSlots.find((x) => x.id === item.slotId);
  if (slot) {
    const inSlot = u.equippedItemIds.filter((id) => r.items.find((x) => x.id === id)?.slotId === slot.id).length;
    if (inSlot + 1 > slot.maxPerUnit) problems.push(`${unitName}'s ${slot.name} slot is full (${slot.maxPerUnit} item${slot.maxPerUnit === 1 ? "" : "s"}).`);
  }
  return problems;
}

/** The unit after equipping an item (taking it back if it was unequipped from this unit this round). */
export function withEquipped(u: WorldUnit, itemId: string, round: number): Pick<WorldUnit, "equippedItemIds" | "unequipped"> {
  const back = [...unequippedNow(u, round)];
  const i = back.indexOf(itemId);
  if (i >= 0) back.splice(i, 1);
  return {
    equippedItemIds: [...u.equippedItemIds, itemId],
    unequipped: back.length ? { round, itemIds: back } : null,
  };
}

/** The unit after unequipping one copy of an item, or null if it doesn't have it equipped. */
export function withUnequipped(u: WorldUnit, itemId: string, round: number): Pick<WorldUnit, "equippedItemIds" | "unequipped"> | null {
  const i = u.equippedItemIds.indexOf(itemId);
  if (i < 0) return null;
  const equipped = [...u.equippedItemIds];
  equipped.splice(i, 1);
  return {
    equippedItemIds: equipped,
    unequipped: { round, itemIds: [...unequippedNow(u, round), itemId] },
  };
}

/** Item quantities added together, in first-seen order. */
export function mergeItems(lists: ItemQty[][]): ItemQty[] {
  const out = new Map<string, number>();
  for (const l of lists) for (const x of l) if (x.qty > 0) out.set(x.itemId, (out.get(x.itemId) ?? 0) + x.qty);
  return [...out].map(([itemId, qty]) => ({ itemId, qty }));
}

/** Everything a unit has on it: equipped items (one each) and what it carries. */
export function unitItems(u: WorldUnit): ItemQty[] {
  return mergeItems([u.equippedItemIds.map((itemId) => ({ itemId, qty: 1 })), u.carried ?? []]);
}

/** "2× Iron Ingot, +1 Armour". */
export function itemsText(items: ItemQty[], itemName: (id: string) => string): string {
  return items.map((x) => `${x.qty > 1 ? `${x.qty}× ` : ""}${itemName(x.itemId)}`).join(", ");
}
