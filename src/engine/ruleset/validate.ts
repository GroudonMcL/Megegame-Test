import type { Effect } from "./effects";
import { RULESET_SECTIONS, Ruleset, type RulesetInput } from "./ruleset";

export interface Problem {
  /** Where it is, e.g. "recipes › iron-sword › inputs". */
  path: string;
  message: string;
}

/** Parses JSON-ish input into a Ruleset, listing every problem in plain words. */
export function parseRuleset(input: unknown): { ok: true; ruleset: Ruleset } | { ok: false; problems: Problem[] } {
  const parsed = Ruleset.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => ({ path: describePath(input as RulesetInput, i.path), message: i.message })),
    };
  }
  return { ok: true, ruleset: parsed.data };
}

/** Turns ["items", 3, "effects", 0] into "items › chain-shirt › effects › 1". */
function describePath(input: RulesetInput, path: PropertyKey[]): string {
  const out: string[] = [];
  let node: unknown = input;
  for (const key of path) {
    const next = node && typeof node === "object" ? (node as Record<PropertyKey, unknown>)[key as never] : undefined;
    if (typeof key === "number" && next && typeof next === "object" && "id" in next && typeof next.id === "string") {
      out.push(next.id);
    } else {
      out.push(typeof key === "number" ? String(key + 1) : String(key));
    }
    node = next;
  }
  return out.join(" › ");
}

/**
 * Checks that everything referred to by ID exists and that IDs are unique.
 * These are warnings: the DM may save half-finished work, but should fix them.
 */
export function findReferenceProblems(r: Ruleset): Problem[] {
  const problems: Problem[] = [];
  const ids = Object.fromEntries(
    RULESET_SECTIONS.map((s) => [s, new Set((r[s] as { id: string }[]).map((x) => x.id))]),
  ) as Record<(typeof RULESET_SECTIONS)[number], Set<string>>;

  for (const section of RULESET_SECTIONS) {
    const seen = new Set<string>();
    for (const x of r[section] as { id: string }[]) {
      if (seen.has(x.id)) problems.push({ path: `${section} › ${x.id}`, message: `The ID "${x.id}" is used more than once.` });
      seen.add(x.id);
    }
  }

  const need = (path: string, section: (typeof RULESET_SECTIONS)[number], id: string | null | undefined, what: string) => {
    if (id && !ids[section].has(id)) problems.push({ path, message: `Refers to ${what} "${id}", which doesn't exist.` });
  };
  const resources = (path: string, amounts: Record<string, number>) => {
    for (const k of Object.keys(amounts)) need(path, "resources", k, "resource");
  };
  const effects = (path: string, list: Effect[]) => {
    list.forEach((e, i) => {
      const p = `${path} › effect ${i + 1}`;
      if (e.type === "freeActions") need(p, "actionTypes", e.actionTypeId, "action type");
      if (e.type === "rollEachRound") need(p, "rollTables", e.tableId, "roll table");
      if (e.type === "raiseSlain") need(p, "creatures", e.asCreatureId, "creature");
      if (e.type === "exchange") e.rates.forEach((rate) => (resources(p, rate.give), resources(p, rate.get)));
    });
  };

  for (const t of r.settlementTiers) {
    const p = `settlementTiers › ${t.id}`;
    need(p, "settlementTiers", t.upgradesFrom, "settlement tier");
    resources(p, t.cost);
    resources(p, t.production);
    resources(p, t.upkeep);
    t.discounts.forEach((d) => resources(p, d.amount));
    effects(p, t.effects);
  }
  for (const b of r.buildings) {
    b.tiers.forEach((tier, i) => {
      const p = `buildings › ${b.id} › tier ${i + 1}`;
      resources(p, tier.cost);
      resources(p, tier.upkeep);
      resources(p, tier.production);
      effects(p, tier.effects);
    });
  }
  for (const race of r.races) effects(`races › ${race.id}`, race.effects);
  for (const c of r.creatures) {
    const p = `creatures › ${c.id}`;
    if (c.costOverride) resources(p, c.costOverride);
    if (c.upkeepOverride) resources(p, c.upkeepOverride);
    c.unlocksActions.forEach((a) => need(p, "actionTypes", a, "action type"));
    c.harvest.forEach((h) => need(p, "items", h.itemId, "item"));
    effects(p, c.effects);
  }
  for (const item of r.items) {
    const p = `items › ${item.id}`;
    need(p, "itemCategories", item.categoryId, "item category");
    need(p, "augmentSlots", item.slotId, "augment slot");
    item.requiresRaces.forEach((x) => need(p, "races", x, "race"));
    effects(p, item.effects);
  }
  for (const recipe of r.recipes) {
    const p = `recipes › ${recipe.id}`;
    [...recipe.inputs, ...recipe.outputs].forEach((x) => need(p, "items", x.itemId, "item"));
    resources(p, recipe.resources);
  }
  for (const a of r.actionTypes) {
    const p = `actionTypes › ${a.id}`;
    resources(p, a.cost);
    if (a.check) need(p, "rollTables", a.check.tableId, "roll table");
    if (a.limit.buildingId) need(p, "buildings", a.limit.buildingId, "building");
    for (const req of a.requirements) {
      if (req.type === "unitOfCreature") need(p, "creatures", req.creatureId, "creature");
      if (req.type === "buildingInRegion") need(p, "buildings", req.buildingId, "building");
      if (req.type === "settlementPresent") need(p, "settlementTiers", req.minTierId, "settlement tier");
      if (req.type === "itemInInventory") need(p, "items", req.itemId, "item");
    }
  }
  for (const t of r.rollTables) {
    const p = `rollTables › ${t.id}`;
    if (t.buildingBonus) need(p, "buildings", t.buildingBonus.buildingId, "building");
    t.bands.forEach((band, i) => {
      if (band.max !== null && band.max < band.min) {
        problems.push({ path: `${p} › band ${i + 1}`, message: `Range ${band.min}–${band.max} is backwards.` });
      }
      for (const res of band.results) {
        if (res.type === "gainResource") need(p, "resources", res.resourceId, "resource");
        if (res.type === "gainItem") need(p, "items", res.itemId, "item");
        if (res.type === "rollTable") need(p, "rollTables", res.tableId, "roll table");
        if (res.type === "spawnMonster") need(p, "creatures", res.creatureId, "creature");
      }
    });
  }
  for (const row of r.settings.crCosts) {
    resources("settings › CR costs", row.cost);
    resources("settings › CR costs", row.upkeep);
  }
  return problems;
}
