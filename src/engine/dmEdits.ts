// Changes the DM makes to a team while viewing as it: working out what changed,
// whether an undo is still safe, and the suggested note to the team ("The DM
// gave you 2× Iron Ingot"). No database code here; src/lib/dmEdits.ts uses it.

/** The largest quantity of one item the DM can set. */
export const MAX_ITEM_QTY = 1_000_000;

/** Item quantities before and after an edit, for only the items that changed (0 = none). */
export interface InventoryChange {
  before: Record<string, number>;
  after: Record<string, number>;
}

/**
 * Compares the team's inventory with the quantities the DM asked for. Items
 * the DM didn't mention keep their quantity. Returns null if nothing changes.
 */
export function planInventoryEdit(current: Record<string, number>, wanted: Record<string, number>): InventoryChange | null {
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (const [id, raw] of Object.entries(wanted)) {
    const qty = Math.max(0, Math.min(MAX_ITEM_QTY, Math.floor(raw)));
    const now = current[id] ?? 0;
    if (!Number.isFinite(qty) || qty === now) continue;
    before[id] = now;
    after[id] = qty;
  }
  return Object.keys(after).length ? { before, after } : null;
}

/** Which recipes the team knows, before and after an edit, for only the recipes that changed. */
export interface RecipeChange {
  before: Record<string, boolean>;
  after: Record<string, boolean>;
}

/**
 * Teach (true) or forget (false) recipes. Recipes known at the start are
 * always known, so they can't be changed. Returns null if nothing changes.
 */
export function planRecipeEdit(knownIds: string[], wanted: Record<string, boolean>, knownAtStart: ReadonlySet<string>): RecipeChange | null {
  const known = new Set(knownIds);
  const before: Record<string, boolean> = {};
  const after: Record<string, boolean> = {};
  for (const [id, want] of Object.entries(wanted)) {
    if (knownAtStart.has(id) || known.has(id) === want) continue;
    before[id] = known.has(id);
    after[id] = want;
  }
  return Object.keys(after).length ? { before, after } : null;
}

/** The team's stored recipe list with a change applied. */
export function applyRecipeChange(knownIds: string[], change: Record<string, boolean>): string[] {
  const known = new Set(knownIds);
  for (const [id, on] of Object.entries(change)) {
    if (on) known.add(id);
    else known.delete(id);
  }
  return [...known];
}

/**
 * For an undo: the keys whose current value is no longer what the change left
 * (something else changed them since). Empty = safe to undo.
 */
export function staleKeys<T>(left: Record<string, T>, current: Record<string, T>, missing: T): string[] {
  return Object.keys(left).filter((k) => (current[k] ?? missing) !== left[k]);
}

// ——— Suggested notes to the team ———

/** "a", "a and b", "a, b and c". */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

const qtyName = (qty: number, name: string) => `${qty}× ${name}`;

/** What an inventory change gave and took, as "2× Iron Ingot" phrases. */
function inventoryParts(change: InventoryChange, itemName: (id: string) => string) {
  const gave: string[] = [];
  const took: string[] = [];
  for (const [id, after] of Object.entries(change.after)) {
    const diff = after - (change.before[id] ?? 0);
    if (diff > 0) gave.push(qtyName(diff, itemName(id)));
    if (diff < 0) took.push(qtyName(-diff, itemName(id)));
  }
  return { gave: joinList(gave), took: joinList(took) };
}

/** "The DM gave you 2× Iron Ingot and took 1× Rope." */
export function inventoryNote(change: InventoryChange, itemName: (id: string) => string): string {
  const { gave, took } = inventoryParts(change, itemName);
  const parts = [gave && `gave you ${gave}`, took && `took ${took}`].filter(Boolean);
  return parts.length ? `The DM ${parts.join(" and ")}.` : "";
}

/** For the DM's change list: "Gave Iron Clan 2× Iron Ingot; took 1× Rope". */
export function inventoryDescription(change: InventoryChange, itemName: (id: string) => string, teamName: string): string {
  const { gave, took } = inventoryParts(change, itemName);
  return [gave && `Gave ${teamName} ${gave}`, took && `${gave ? "took" : `Took from ${teamName}`} ${took}`].filter(Boolean).join("; ");
}

function recipeParts(change: RecipeChange, recipeName: (id: string) => string) {
  const ids = Object.keys(change.after);
  return { taught: ids.filter((id) => change.after[id]).map(recipeName), forgot: ids.filter((id) => !change.after[id]).map(recipeName) };
}
const recipes = (n: number) => (n === 1 ? "recipe" : "recipes");

/** "The DM taught you the recipe for Steel Sword. You forgot the recipe for Rope." */
export function recipeNote(change: RecipeChange, recipeName: (id: string) => string): string {
  const { taught, forgot } = recipeParts(change, recipeName);
  return [
    taught.length ? `The DM taught you the ${recipes(taught.length)} for ${joinList(taught)}.` : "",
    forgot.length ? `You forgot the ${recipes(forgot.length)} for ${joinList(forgot)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** For the DM's change list: "Taught Iron Clan the recipe for Steel Sword; made it forget Rope". */
export function recipeDescription(change: RecipeChange, recipeName: (id: string) => string, teamName: string): string {
  const { taught, forgot } = recipeParts(change, recipeName);
  return [
    taught.length ? `Taught ${teamName} the ${recipes(taught.length)} for ${joinList(taught)}` : "",
    forgot.length ? `${taught.length ? "made it" : `Made ${teamName}`} forget ${joinList(forgot)}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function renameNote(oldName: string, newName: string): string {
  if (!newName) return `The DM cleared the name of ${oldName || "a unit"}.`;
  return oldName ? `The DM renamed ${oldName} to ${newName}.` : `The DM named one of your units ${newName}.`;
}

/** For the DM's change list. */
export function renameDescription(oldName: string, newName: string, teamName: string): string {
  return `Renamed ${oldName || "a unit"} to ${newName || "(no name)"} (${teamName})`;
}

export function ordersNote(count: number, round: number | null): string {
  const when = round ? ` for round ${round}` : "";
  return `The DM changed your orders${when} (${count} order${count === 1 ? "" : "s"}).`;
}

export type TradeStep = "propose" | "accept" | "decline" | "cancel";

export function tradeNote(step: TradeStep, otherTeam: string): string {
  switch (step) {
    case "propose":
      return `The DM proposed a trade to ${otherTeam} for you.`;
    case "accept":
      return `The DM accepted the trade from ${otherTeam} for you.`;
    case "decline":
      return `The DM declined the trade from ${otherTeam} for you.`;
    case "cancel":
      return `The DM called off your trade with ${otherTeam}.`;
  }
}

/** A recipe's name: what it makes ("2× Arrow + Bow"). */
export function recipeLabel(recipe: { outputs: { itemId: string; qty: number }[] }, itemName: (id: string) => string): string {
  return recipe.outputs.map((o) => `${o.qty > 1 ? `${o.qty}× ` : ""}${itemName(o.itemId)}`).join(" + ");
}
