import { z } from "zod";
import { Ability, DiceExpr, Id, ResourceAmounts } from "./common";
import { Effect } from "./effects";
import { ActionProfile, REVIEW_STATES, StatBlock } from "./statblock";

// The complete, DM-configurable ruleset for one game. It is plain JSON, so it
// can be exported, imported, copied from a preset, and edited by hand.

export const RULESET_FORMAT_VERSION = 1;

export const Resource = z.object({
  id: Id,
  name: z.string().min(1),
  icon: z.string().default(""),
  colour: z.string().default("#888888"),
  /** stockpile = can be spent; accumulating = only counts up (e.g. score). */
  kind: z.enum(["stockpile", "accumulating"]).default("stockpile"),
  startingAmount: z.number().default(0),
});

export const TerrainType = z.object({
  id: Id,
  name: z.string().min(1),
  /** Miles count this many times (difficult terrain = 2). */
  costMultiplier: z.number().positive().default(1),
  bypassedByFlying: z.boolean().default(false),
  bypassedByNaturalExplorer: z.boolean().default(false),
  /** If non-empty, a unit needs at least one of these speeds to cross. */
  requiresMovement: z.array(z.enum(["fly", "swim", "climb", "burrow"])).default([]),
});

export const SettlementTier = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(""),
  /** The tier this one upgrades from; null = built on an empty region. */
  upgradesFrom: Id.nullable().default(null),
  cost: ResourceAmounts.default({}),
  /** Subtracted from the cost when a condition holds (e.g. a Ruin is present). */
  discounts: z.array(z.object({ when: z.enum(["ruinPresent"]), amount: ResourceAmounts })).default([]),
  buildingSlots: z.number().int().min(0),
  production: ResourceAmounts.default({}),
  upkeep: ResourceAmounts.default({}),
  maxPerTeam: z.number().int().positive().nullable().default(null),
  /** Creature categories that can be recruited here. */
  recruitCategories: z.array(z.string()).default([]),
  /**
   * "For every settlement of this tier you need N others of tier X": counted
   * when building one (the new one included).
   */
  ratio: z.array(z.object({ tierId: Id, count: z.number().int().positive() })).default([]),
  /** Max living heroes recruited per settlement of this tier; null = no limit. */
  heroLimit: z.number().int().min(0).nullable().default(null),
  requiresUnclaimed: z.boolean().default(false),
  requiresNoHostiles: z.boolean().default(false),
  effects: z.array(Effect).default([]),
});

export const BuildingTier = z.object({
  description: z.string().default(""),
  cost: ResourceAmounts.default({}),
  upkeep: ResourceAmounts.default({}),
  production: ResourceAmounts.default({}),
  effects: z.array(Effect).default([]),
});

export const Building = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Tier 1 first. Higher tiers are reached only by upgrading. */
  tiers: z.array(BuildingTier).min(1),
  /** Something chosen when it's built, e.g. the Academy's ability score. */
  buildChoice: z.enum(["none", "ability"]).default("none"),
  maxPerRegion: z.number().int().positive().nullable().default(1),
});

export const Race = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(""),
  abilityBonuses: z.partialRecord(Ability, z.number().int()).default({}),
  effects: z.array(Effect).default([]),
});

export const CREATURE_CATEGORIES = ["standard", "hero", "monster", "leader"] as const;

export const Creature = z.object({
  id: Id,
  /** Where the stat block came from. */
  source: z.object({ kind: z.enum(["srd-2024", "custom"]), ref: z.string().default("") }),
  category: z.enum(CREATURE_CATEGORIES),
  /** Can teams recruit this? (Monster library entries usually can't.) */
  recruitable: z.boolean().default(false),
  /** e.g. Miner, Stealthy, Healer, Regiment. Used by action requirements and effects. */
  tags: z.array(z.string()).default([]),
  description: z.string().default(""),
  statBlock: StatBlock,
  /** Null = use the CR cost table. */
  costOverride: ResourceAmounts.nullable().default(null),
  upkeepOverride: ResourceAmounts.nullable().default(null),
  /** Regions away this unit can see (0 = only its own region). */
  visionRange: z.number().int().min(0).default(0),
  /** Action types this creature makes available (beyond tag requirements). */
  unlocksActions: z.array(Id).default([]),
  /** Megagame-level abilities (Martial Advantage, Defender…). */
  effects: z.array(Effect).default([]),
  /** What Extract Monster can yield from its corpse. */
  harvest: z.array(z.object({ itemId: Id, qty: z.number().int().positive() })).default([]),
});
export type Creature = z.infer<typeof Creature>;

export const Spell = z.object({
  id: Id,
  name: z.string().min(1),
  /** e.g. Arcane, Divine, Primal. */
  tradition: z.string().default(""),
  /** Who can learn it, in words (e.g. "Any Arcane", "War Priest"). */
  restriction: z.string().default(""),
  /** Combat spells replace an attack; out-of-combat spells are cast with an action. */
  when: z.enum(["combat", "outOfCombat"]),
  description: z.string().default(""),
  cost: ResourceAmounts.default({}),
  profile: ActionProfile.default({ kind: "text" }),
  review: z.enum(REVIEW_STATES).default("text"),
});
export type Spell = z.infer<typeof Spell>;

/**
 * A role a player chooses for a recruited unit (Scout, Regiment, Defender…),
 * layered on top of the creature's stat block.
 */
export const Archetype = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(""),
  /** Creature categories that may take this archetype. */
  categories: z.array(z.enum(CREATURE_CATEGORIES)).default(["standard"]),
  /** Tags the unit gains (used by action requirements and effects). */
  tags: z.array(z.string()).default([]),
  effects: z.array(Effect).default([]),
  unlocksActions: z.array(Id).default([]),
  /** Null = keep the creature's own vision. */
  visionRange: z.number().int().min(0).nullable().default(null),
  /** Can only be recruited in a region with this building. */
  recruitRequiresBuildingId: Id.nullable().default(null),
  /** Added to the creature's recruit cost and upkeep. */
  extraCost: ResourceAmounts.default({}),
  extraUpkeep: ResourceAmounts.default({}),
});
export type Archetype = z.infer<typeof Archetype>;

export const ItemCategory = z.object({
  id: Id,
  name: z.string().min(1),
  equippable: z.boolean().default(false),
});

export const AugmentSlot = z.object({
  id: Id,
  name: z.string().min(1),
  maxPerUnit: z.number().int().positive().default(1),
});

export const Item = z.object({
  id: Id,
  name: z.string().min(1),
  categoryId: Id,
  description: z.string().default(""),
  rarity: z.string().default("common"),
  /** Augments only. */
  slotId: Id.nullable().default(null),
  /** Tags used by requirements and hazards, e.g. "heat-resistant". */
  tags: z.array(z.string()).default([]),
  /** The unit must have all of these tags (e.g. "Martial"). */
  requiresUnitTags: z.array(z.string()).default([]),
  /** The unit must be one of these races (empty = any). */
  requiresRaces: z.array(Id).default([]),
  effects: z.array(Effect).default([]),
  consumable: z.boolean().default(false),
});

export const Recipe = z.object({
  id: Id,
  inputs: z.array(z.object({ itemId: Id, qty: z.number().int().positive() })).min(1),
  resources: ResourceAmounts.default({}),
  outputs: z.array(z.object({ itemId: Id, qty: z.number().int().positive() })).min(1),
  knownAtStart: z.boolean().default(false),
});

export const ACTION_HANDLERS = [
  "move",
  "recruit",
  "constructSettlement",
  "upgradeSettlement",
  "constructBuilding",
  "upgradeBuilding",
  "demolish",
  "annex",
  "heal",
  "raid",
  "applyAugment",
  "disband",
  "trade",
  "market",
  "craft",
  "research",
  "portal",
  "teleport",
  "attack",
  "capture",
  "tame",
  "storeBeast",
  "retrieveBeast",
  "reanimate",
  "useItem",
  "castSpell",
  "train",
  "convert",
  "rollCheck",
  "manual",
] as const;

export const Requirement = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unitWithTag"), tag: z.string().min(1) }),
  z.object({ type: z.literal("unitOfCreature"), creatureId: Id }),
  z.object({ type: z.literal("buildingInRegion"), buildingId: Id, minTier: z.number().int().positive().default(1) }),
  z.object({ type: z.literal("regionOwner"), owner: z.enum(["self", "unowned", "other"]) }),
  z.object({ type: z.literal("noHostileUnits") }),
  z.object({ type: z.literal("ownUnitInRegion") }),
  z.object({ type: z.literal("unitHasMovement") }),
  z.object({ type: z.literal("unitStealthed") }),
  z.object({ type: z.literal("settlementPresent"), minTierId: Id.optional() }),
  z.object({ type: z.literal("freeSlot") }),
  z.object({ type: z.literal("itemInInventory"), itemId: Id.optional() }),
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
]);

export const ActionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unit"), label: z.string().default("Unit"), multiple: z.boolean().default(false), tag: z.string().optional() }),
  z.object({ type: z.literal("region"), label: z.string().default("Region") }),
  /** Another team's unit or a monster the team can see, in the same region as the acting units. */
  z.object({ type: z.literal("targetUnit"), label: z.string().default("Target"), monstersOnly: z.boolean().default(false) }),
  z.object({ type: z.literal("path"), label: z.string().default("Path") }),
  z.object({ type: z.literal("creature"), label: z.string().default("Unit type") }),
  z.object({ type: z.literal("race"), label: z.string().default("Race") }),
  z.object({ type: z.literal("archetype"), label: z.string().default("Archetype") }),
  z.object({ type: z.literal("spell"), label: z.string().default("Spell") }),
  z.object({ type: z.literal("building"), label: z.string().default("Building") }),
  z.object({ type: z.literal("settlementTier"), label: z.string().default("Settlement") }),
  z.object({ type: z.literal("item"), label: z.string().default("Item") }),
  z.object({ type: z.literal("recipe"), label: z.string().default("Recipe") }),
  z.object({ type: z.literal("team"), label: z.string().default("Team") }),
  z.object({ type: z.literal("resources"), label: z.string().default("Resources") }),
  z.object({ type: z.literal("ability"), label: z.string().default("Ability") }),
  z.object({ type: z.literal("number"), label: z.string().min(1), min: z.number().optional() }),
  z.object({ type: z.literal("choice"), label: z.string().min(1), options: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("text"), label: z.string().min(1) }),
]);

export const ActionType = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().default(""),
  /** numberedAndFree = one free use (per its limit) and extra uses cost a numbered slot. */
  kind: z.enum(["numbered", "free", "conditional", "numberedAndFree"]),
  /** How often it can be used; per = what the count is per. Null times = no limit. */
  limit: z
    .object({ times: z.number().int().positive().nullable(), per: z.enum(["team", "unit", "building"]), buildingId: Id.optional() })
    .default({ times: null, per: "team" }),
  requirements: z.array(Requirement).default([]),
  inputs: z.array(ActionInput).default([]),
  cost: ResourceAmounts.default({}),
  handler: z.enum(ACTION_HANDLERS),
  /** Handler settings, e.g. { "mode": "forceMarch" } for Move. */
  config: z.record(z.string(), z.unknown()).default({}),
  /** For check-based actions: which abilities may be used (best is taken) and the outcome table. */
  check: z.object({ abilities: z.array(Ability).min(1), tableId: Id }).nullable().default(null),
});

export const TableResult = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gainResource"), resourceId: Id, amount: DiceExpr }),
  z.object({ type: z.literal("gainItem"), itemId: Id, qty: DiceExpr.default("1") }),
  z.object({ type: z.literal("rollTable"), tableId: Id, times: z.number().int().positive().default(1), ignore: z.array(z.number().int()).default([]) }),
  z.object({ type: z.literal("damageActor"), dice: DiceExpr }),
  z.object({ type: z.literal("spawnMonster"), creatureId: Id.nullable().default(null), count: DiceExpr.default("1") }),
  /** Survivors join: the team can recruit units of this race from now on. */
  z.object({ type: z.literal("gainRace"), raceId: Id }),
  z.object({ type: z.literal("revealConnection") }),
  z.object({ type: z.literal("revealRegion") }),
  z.object({ type: z.literal("addDeposit"), note: z.string().default("") }),
  z.object({ type: z.literal("findStructure"), kind: z.enum(["ruin", "dungeon"]) }),
  z.object({ type: z.literal("learnRecipes"), count: DiceExpr }),
  z.object({ type: z.literal("moveActor"), regions: z.number().int().min(0), random: z.boolean().default(false) }),
]);

export const RollTable = z.object({
  id: Id,
  name: z.string().min(1),
  category: z.enum(["check", "loot", "encounter", "event", "deficit", "building", "other"]).default("other"),
  die: DiceExpr.default("1d20"),
  /** Plain description of what's added to the roll, shown to the DM. */
  modifierNote: z.string().default(""),
  /** Flat bonus per tier of a building in the region (e.g. +1 per Hunter Post tier). */
  buildingBonus: z.object({ buildingId: Id, perTier: z.number() }).nullable().default(null),
  /** Deficit tables: the resource this table is for (null = any), and the bonus per unit of deficit. */
  deficitResourceId: Id.nullable().default(null),
  deficitPerUnit: z.number().default(0),
  /** +1 for every this many regions the team owns (e.g. a turn-event table: +1 per 6 regions). */
  perRegionsBonus: z.number().int().positive().nullable().default(null),
  bands: z
    .array(
      z.object({
        min: z.number().int(),
        /** Null = this number and above. */
        max: z.number().int().nullable(),
        text: z.string().default(""),
        results: z.array(TableResult).default([]),
      }),
    )
    .min(1),
});

export const RulesSection = z.object({ id: Id, title: z.string().min(1), body: z.string().default("") });

export const CrCostRow = z.object({
  /** Applies to this creature category ("any" = all). */
  category: z.enum([...CREATURE_CATEGORIES, "any"]).default("any"),
  maxCr: z.number().min(0),
  cost: ResourceAmounts,
  upkeep: ResourceAmounts,
});

/** Footprint = the creature's D&D space × 6, with Small half of Medium. */
export const DEFAULT_FOOTPRINTS = { tiny: 7.5, small: 15, medium: 30, large: 60, huge: 90, gargantuan: 120 };
const FootprintFt = z.object({
  tiny: z.number().positive(),
  small: z.number().positive(),
  medium: z.number().positive(),
  large: z.number().positive(),
  huge: z.number().positive(),
  gargantuan: z.number().positive(),
});

export const Settings = z.object({
  actionSlots: z.number().int().min(1).max(20).default(6),
  conditionalLimit: z.number().int().min(0).default(2),
  maxAugmentsPerUnit: z.number().int().min(0).default(3),
  movement: z
    .object({
      /** D&D normal pace: 24 miles per day for a 30 ft walking speed. */
      milesPerDayAt30ft: z.number().positive().default(24),
      travelDaysPerRound: z.number().positive().default(1),
      defaultConnectionMiles: z.number().positive().default(12),
      forceMarchMultiplier: z.number().positive().default(2),
      stealthMultiplier: z.number().positive().default(0.5),
    })
    .default({ milesPerDayAt30ft: 24, travelDaysPerRound: 1, defaultConnectionMiles: 12, forceMarchMultiplier: 2, stealthMultiplier: 0.5 }),
  combat: z
    .object({
      maxRounds: z.number().int().positive().default(10),
      /** Width in feet that one unit of each size takes up, for area effects. */
      footprintFt: FootprintFt.default(DEFAULT_FOOTPRINTS),
      usesReset: z.enum(["round", "combat"]).default("round"),
      /** Team units below this fraction of their max HP retreat (monsters fight on). 0 = never. */
      retreatBelow: z.number().min(0).max(1).default(0.25),
      /** Fights simulated for "Show odds". */
      oddsRuns: z.number().int().min(10).max(2000).default(200),
    })
    .default({ maxRounds: 10, footprintFt: DEFAULT_FOOTPRINTS, usesReset: "round", retreatBelow: 0.25, oddsRuns: 200 }),
  /** Recruit cost and upkeep by Challenge Rating; first matching row wins. */
  crCosts: z.array(CrCostRow).default([]),
  /** Demolish refund fraction. */
  demolishRefund: z.number().min(0).max(1).default(0.5),
  /** Free actions each unit may take per round (null = no limit). */
  freeActionsPerUnit: z.number().int().min(0).nullable().default(null),
  /** Roll the event table at the end of each round: for nobody (the DM picks) or every team. */
  roundEvents: z.enum(["off", "all"]).default("off"),
  fog: z
    .object({
      /** Regions seen before stay on a team's map, dimmed, with what the team last saw. */
      showPreviouslySeen: z.boolean().default(true),
      /** Darken the map image outside what the team can see. Off = players see the whole image. */
      fogImage: z.boolean().default(true),
      /** Radius of the clear circle around each seen region, as a fraction of the map's width. */
      revealRadius: z.number().positive().max(1).default(0.07),
    })
    .default({ showPreviouslySeen: true, fogImage: true, revealRadius: 0.07 }),
});

export const Ruleset = z.object({
  format: z.literal(RULESET_FORMAT_VERSION).default(RULESET_FORMAT_VERSION),
  meta: z
    .object({
      name: z.string().default("Untitled ruleset"),
      description: z.string().default(""),
      /** Words the DM has renamed, e.g. { "region": "Province", "unit": "Warband" }. */
      terminology: z.record(z.string(), z.string()).default({}),
      theme: z.object({ primaryColour: z.string().default("#4f46e5"), logoUrl: z.string().default("") }).default({ primaryColour: "#4f46e5", logoUrl: "" }),
      /** Credit lines shown in the rules reference (e.g. SRD licence). */
      attributions: z.array(z.string()).default([]),
    })
    .default({ name: "Untitled ruleset", description: "", terminology: {}, theme: { primaryColour: "#4f46e5", logoUrl: "" }, attributions: [] }),
  settings: Settings.default(Settings.parse({})),
  resources: z.array(Resource).default([]),
  terrainTypes: z.array(TerrainType).default([]),
  settlementTiers: z.array(SettlementTier).default([]),
  buildings: z.array(Building).default([]),
  races: z.array(Race).default([]),
  creatures: z.array(Creature).default([]),
  archetypes: z.array(Archetype).default([]),
  spells: z.array(Spell).default([]),
  itemCategories: z.array(ItemCategory).default([]),
  augmentSlots: z.array(AugmentSlot).default([]),
  items: z.array(Item).default([]),
  recipes: z.array(Recipe).default([]),
  actionTypes: z.array(ActionType).default([]),
  rollTables: z.array(RollTable).default([]),
  rulesSections: z.array(RulesSection).default([]),
});
export type Ruleset = z.infer<typeof Ruleset>;
export type RulesetInput = z.input<typeof Ruleset>;

/** The editable top-level lists, in the order the editor shows them. */
export const RULESET_SECTIONS = [
  "resources",
  "terrainTypes",
  "settlementTiers",
  "buildings",
  "races",
  "creatures",
  "archetypes",
  "spells",
  "itemCategories",
  "augmentSlots",
  "items",
  "recipes",
  "actionTypes",
  "rollTables",
  "rulesSections",
] as const;
export type RulesetSection = (typeof RULESET_SECTIONS)[number];

export const SECTION_SCHEMAS = {
  resources: Resource,
  terrainTypes: TerrainType,
  settlementTiers: SettlementTier,
  buildings: Building,
  races: Race,
  creatures: Creature,
  archetypes: Archetype,
  spells: Spell,
  itemCategories: ItemCategory,
  augmentSlots: AugmentSlot,
  items: Item,
  recipes: Recipe,
  actionTypes: ActionType,
  rollTables: RollTable,
  rulesSections: RulesSection,
} as const;

export function emptyRuleset(): Ruleset {
  return Ruleset.parse({});
}
