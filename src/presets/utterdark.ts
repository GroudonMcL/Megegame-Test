import type { z } from "zod";
import type { Effect } from "@/engine/ruleset/effects";
import { Ruleset, TableResult as TableResultSchema, type RulesetInput } from "@/engine/ruleset/ruleset";
import type { ActionProfile } from "@/engine/ruleset/statblock";
import { SRD_ATTRIBUTION, srdByName } from "@/engine/srd/library";
import { ENCOUNTER_MONSTERS, ENCOUNTER_TABLES, harvestFor, SHEET_ITEMS, SHEET_RACES, SHEET_RECIPES, SHEET_TABLES } from "./utterdarkData";

// "Descent into the Utterdark", built from reference/utterdark-rules.md and the
// DM sheet (reference/utterdark-dm-sheet.csv). Anything marked PLACEHOLDER isn't
// in either and waits for the DM: roll tables, races, augments, recipes and
// starting resources. See docs/utterdark-preset.md.

const P = "PLACEHOLDER — replace with the DM's values.";

type CreatureInput = NonNullable<RulesetInput["creatures"]>[number];
type ArchetypeInput = NonNullable<RulesetInput["archetypes"]>[number];
type SpellInput = NonNullable<RulesetInput["spells"]>[number];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** An SRD 5.2 creature, under its own SRD name. */
function srd(srdName: string, extra: Omit<Partial<CreatureInput>, "statBlock" | "source"> & Pick<CreatureInput, "category">): CreatureInput {
  const m = srdByName(srdName);
  return { id: slug(srdName), source: { kind: "srd-2024", ref: m.index }, statBlock: m.statBlock, harvest: harvestFor(srdName), ...extra };
}

type Modifier = Extract<Effect, { type: "modifier" }>;
const modifier = (target: string, value: number, extra: Partial<Modifier> = {}): Modifier => ({
  type: "modifier",
  target,
  value,
  when: [],
  ...extra,
});
const text = (t: string): Effect => ({ type: "text", text: t });
const spells = (...spellIds: string[]): Effect => ({ type: "spells", spellIds, uses: { type: "perCombat", times: 1 } });

const fortification = (n: number) => [
  modifier("ac", n, { tagMultiplier: { tag: "Defender", factor: 2 } }),
  modifier("toHit", n, { tagMultiplier: { tag: "Defender", factor: 2 } }),
];

type TableResult = z.input<typeof TableResultSchema>;
const band = (min: number, max: number | null, text: string, results: TableResult[] = []) => ({ min, max, text, results });

// Spells use the caster's DC: Intelligence for Arcane, Wisdom for Divine and Primal.
const DC_ABILITY = { Arcane: "int", Divine: "wis", Primal: "wis" } as const;
type Tradition = keyof typeof DC_ABILITY;

function spell(
  name: string,
  tradition: Tradition,
  restriction: string,
  when: "combat" | "outOfCombat",
  description: string,
  profile: ActionProfile = { kind: "text" },
  review: SpellInput["review"] = profile.kind === "text" ? "text" : "needsReview",
  cost: Record<string, number> = {},
): SpellInput {
  return { id: slug(name), name, tradition, restriction, when, description, profile, review, cost };
}

function saveDamage(tradition: Tradition, save: "str" | "dex" | "con" | "int" | "wis" | "cha", orSave: typeof save | undefined, amount: number, type: "force" | "radiant" | "necrotic" | "thunder" | "poison", extra: Partial<Extract<ActionProfile, { kind: "save" }>> = {}): ActionProfile {
  return {
    kind: "save",
    dc: { save, ...(orSave ? { orSave } : {}), ability: DC_ABILITY[tradition], flat: 0 },
    damage: [{ dice: String(amount), ability: null, flat: 0, type }],
    onSuccess: "none",
    targets: 1,
    ...extra,
  };
}

const SPELLS: SpellInput[] = [
  spell("Blast", "Arcane", "Any Arcane", "combat", "Hostile target must make either a Con/Dex save or take 15 damage.", saveDamage("Arcane", "con", "dex", 15, "force")),
  spell("Greater Blast", "Arcane", "Archmage", "combat", "Hostile target must make either a Con/Dex save or take 20 damage.", saveDamage("Arcane", "con", "dex", 20, "force")),
  spell("Smite", "Divine", "War Priest", "combat", "Hostile target must make a Con/Dex save or take 15 damage.", saveDamage("Divine", "con", "dex", 15, "radiant")),
  spell("Harm", "Arcane", "Necromancer", "combat", "Hostile creature must make a Str/Con save or take 30 damage. This cannot reduce a target's hit points below 1.", saveDamage("Arcane", "str", "con", 30, "necrotic")),
  spell("Shatter", "Arcane", "Any Arcane", "combat", "Choose two hostile targets. Each must make a Str/Con save or take 8 damage. Half on success.", saveDamage("Arcane", "str", "con", 8, "thunder", { onSuccess: "half", targets: 2 }), "auto"),
  spell("Ray of Sickness", "Arcane", "Necromancer", "combat", "Hostile target must make a Con save or take 10 damage and have disadvantage on all rolls on their next turn.", saveDamage("Arcane", "con", undefined, 10, "poison")),
  spell("Magic Missile", "Arcane", "Any Arcane", "combat", "Choose three hostile targets, each taking 3 damage. You can choose the same target multiple times."),
  spell("Charm", "Arcane", "Any Arcane", "combat", "Hostile target must make either a Cha/Wis save or lose their next turn.", {
    kind: "save",
    dc: { save: "cha", orSave: "wis", ability: "int", flat: 0 },
    damage: [],
    onSuccess: "none",
    targets: 1,
    condition: { condition: "charmed", durationRounds: 1, repeatSave: false },
  }),
  spell("Sleep", "Arcane", "Any Arcane", "combat", "Hostile target must make either a Con/Wis save or lose up to four subsequent turns of combat. Any damage taken removes this effect. Targets with more than 40 hit points are immune.", {
    kind: "save",
    dc: { save: "con", orSave: "wis", ability: "int", flat: 0 },
    damage: [],
    onSuccess: "none",
    targets: 1,
    condition: { condition: "unconscious", durationRounds: 4, repeatSave: false },
  }),
  spell("Entangle", "Primal", "Any Primal", "combat", "Hostile target must make a Str/Dex save or be locked into combat. Upon failing, the entangled target cannot flee from combat unless it uses its action to repeat the save."),
  spell("Faerie Fire", "Arcane", "Any Arcane", "combat", "Hostile target must make a Dex/Con save or be coated in Faerie Fire. Upon failing, all attacks made against the target have advantage for the subsequent 2 turns.", {
    kind: "buff",
    target: "enemy",
    effect: "attackedWithAdvantage",
    amount: 0,
    save: { save: "dex", orSave: "con", ability: "int", flat: 0 },
    durationRounds: 2,
  }, "auto"),
  spell("Ray of Enfeeblement", "Arcane", "Archmage", "combat", "Hostile target must make either a Con/Int save or have disadvantage for their two subsequent turns.", {
    kind: "buff",
    target: "enemy",
    effect: "disadvantageAttacks",
    amount: 0,
    save: { save: "con", orSave: "int", ability: "int", flat: 0 },
    durationRounds: 2,
  }),
  spell("Slow", "Arcane", "Any Arcane", "combat", "Hostile target must make either a Wis/Cha saving throw. If it fails, it can only make 1 attack per turn for the subsequent two turns."),
  spell("Bless", "Divine", "War Priest", "combat", "Friendly target gains advantage on attacks and saves for their two subsequent turns.", {
    kind: "buff",
    target: "ally",
    effect: "advantageAttacks",
    amount: 0,
    durationRounds: 2,
  }),
  spell("Haste", "Arcane", "Any Arcane", "combat", "Friendly target gains an additional attack per turn for 2 turns. On the third subsequent turn the target loses its action.", {
    kind: "buff",
    target: "ally",
    effect: "extraAttack",
    amount: 1,
    durationRounds: 2,
  }),
  spell("Heal", "Divine", "Any Divine", "combat", "Friendly target regains 10 hit points.", { kind: "heal", dice: "10", ability: null, flat: 0, targets: 1, revive: false }, "auto"),
  spell("Greater Heal", "Divine", "War Priest", "combat", "Friendly target regains 20 hit points.", { kind: "heal", dice: "20", ability: null, flat: 0, targets: 1, revive: false }, "auto"),
  spell("Revivify", "Divine", "Any Divine", "combat", "Friendly target which has died returns with 1 hit point.", { kind: "heal", dice: "1", ability: null, flat: 0, targets: 1, revive: true }, "auto"),
  spell("Dispel Magic", "Arcane", "Any Arcane", "combat", "Target a hostile creature with a magical item equipped, making a DC 12 spellcasting check. Upon success, the item cannot benefit the target for the subsequent 2 turns."),
  spell("Dominate Beast", "Primal", "Archdruid", "combat", "Hostile beast must make a Wis/Cha save or come under your control for the next two turns of the combat. Beastmaster beasts make this save with advantage."),
  spell("Summon Construct", "Arcane", "Artificer", "combat", "From components carried by the hero you animate a construct which rolls its own initiative, joining combat on its turn. It only remains for this combat and uses the Iron Defender statistics."),
  spell("Summon Undead", "Arcane", "Necromancer", "combat", "From your corpse wagon you animate a zombie or skeleton to join you in battle. It rolls initiative and only remains for this combat."),
  spell("Plant Growth", "Primal", "Druid or Archdruid", "outOfCombat", "If cast in a region containing a farm, improve the farm's yield for the turn: gain additional food."),
  spell("Scry", "Divine", "Archmage", "outOfCombat", "Target a unit you have encountered before. It must make a Wisdom save against your DC. If it fails, you gain line of sight of that unit for the turn."),
  spell("Teleport", "Arcane", "Archmage", "outOfCombat", "Teleport yourself to a region you are familiar with (have a map for). Roll a d100 to determine the accuracy: 50% on target, 25% one region off, 15% two regions off, 10% a random region."),
  spell("Reincarnate", "Primal", "Archdruid", "outOfCombat", "Return a dead creature to life in a new body."),
  spell("Resurrection", "Divine", "War Priest", "outOfCombat", "At a cost of 10 gold, attempt to resurrect a dead hero whose corpse you have and whose soul is free and willing. Friends must convince the soul to return; the caster makes a DC 15 Wisdom check, +1 for each other faction contributing.", { kind: "text" }, "text", { gold: 10 }),
  spell("True Resurrection", "Divine", "War Priest", "outOfCombat", "At a cost of 20 gold, attempt to resurrect a dead hero, providing a new body if needed. Friends must convince the soul to return; the caster makes a DC 15 Wisdom check, +1 for each other faction contributing.", { kind: "text" }, "text", { gold: 20 }),
  spell("Wish", "Arcane", "Archmage", "outOfCombat", "The mightiest spell a mortal can cast."),
];

function archetype(a: Omit<ArchetypeInput, "id"> & { id?: string }): ArchetypeInput {
  // Hero archetypes carry a "Hero" tag, which some augments require.
  const tags = a.categories?.includes("hero") ? [...(a.tags ?? []), "Hero"] : a.tags;
  return { id: a.id ?? slug(a.name), ...a, tags };
}

const LISTED = ["Zombie", "Skeleton", "Iron Golem", "Shield Guardian", "Giant Lizard", "Giant Spider", "Giant Bat", "Drider", "Ghoul", "Gelatinous Cube", "Ochre Jelly", "Gray Ooze", "Otyugh", "Rust Monster", "Basilisk", "Grick", "Roper", "Darkmantle", "Violet Fungus", "Purple Worm"];

function encounterMonsters(): CreatureInput[] {
  return [...ENCOUNTER_MONSTERS]
    .filter((n) => !LISTED.includes(n))
    .sort()
    .map((n) => {
      const type = srdByName(n).statBlock.creatureType;
      return srd(n, { category: "monster", tags: [type[0].toUpperCase() + type.slice(1)] });
    });
}

const ARCHETYPES: ArchetypeInput[] = [
  // Standard units
  archetype({
    name: "Defender",
    description: "Trained to protect a region, using defensive positions to guard settlements.",
    tags: ["Defender"],
    effects: [
      text("Defender: cannot move to a region without an allied outpost. Gains double the benefit from a fortification."),
      text("Vigilant: negates additional damage dealt by hidden units."),
    ],
  }),
  archetype({
    name: "Druid",
    description: "An embodiment of nature's resilience, cunning and fury.",
    tags: ["Spellcaster", "Primal"],
    recruitRequiresBuildingId: "farm",
    effects: [spells("entangle", "faerie-fire"), { type: "spells", spellIds: ["plant-growth"], uses: { type: "perDay", times: 1 } }, text("Tend Nature: in a region with a farm, use an action to gain extra Food equal to the farm's tier (one farm per action, once per Druid per turn).")],
    unlocksActions: ["cast-spell"],
  }),
  archetype({
    name: "Healer",
    description: "Able physicians who mend wounds and get allies back into the fight.",
    tags: ["Healer", "Spellcaster", "Divine"],
    effects: [spells("heal", "revivify"), text("Healer: once per turn, out of combat, use the Heal action for free to restore up to 20 + Wisdom hit points to one unit.")],
  }),
  archetype({
    name: "Mage",
    description: "A small group of wizards and sorcerers: competent casters and keen researchers.",
    tags: ["Spellcaster", "Arcane", "Researcher"],
    effects: [spells("charm", "blast")],
    unlocksActions: ["research"],
  }),
  archetype({
    name: "Miner",
    description: "Hardy labourers who extract rare deposits and tunnel into new regions.",
    tags: ["Miner"],
    recruitRequiresBuildingId: "mine",
    effects: [text("Tunneller: has the Excavate and Extract free actions.")],
    unlocksActions: ["excavate", "extract"],
  }),
  archetype({
    name: "Monk",
    description: "Disciplined fighters who keep calm against the odds.",
    tags: ["Monk"],
    effects: [{ type: "advantage", mode: "advantage", on: "attacks", when: [{ when: "outnumbered" }, { when: "firstRound" }] }],
  }),
  archetype({
    name: "Regiment",
    description: "Capable, disciplined soldiers, ready to fight and die for duty. Needed to raid.",
    tags: ["Regiment", "Martial"],
    effects: [
      { type: "advantage", mode: "advantage", on: "attacks", when: [{ when: "firstRound" }, { when: "alliesOutnumber" }] },
      modifier("damageDice", 1, { when: [{ when: "firstRound" }, { when: "alliesOutnumber" }] }),
    ],
  }),
  archetype({
    name: "Scout",
    description: "Skilled hunters and trackers who stick to the shadows and live off the land.",
    tags: ["Scout", "Stealthy"],
    visionRange: 1,
    effects: [
      { type: "advantage", mode: "advantage", on: "attacks", when: [{ when: "surprising" }, { when: "firstRound" }] },
      modifier("damageDice", 3, { when: [{ when: "surprising" }, { when: "firstRound" }] }),
      { type: "waiveUpkeep", resourceIds: ["food"] },
      text("Survivalist: can use its free action to assist a Hunter's Post, improving its chance of extra boons."),
    ],
    unlocksActions: ["move-stealth", "spy"],
  }),
  // Heroes
  archetype({
    name: "Archdruid",
    categories: ["hero"],
    description: "Watches over the natural wonders of its domain.",
    tags: ["Spellcaster", "Primal"],
    effects: [spells("entangle", "faerie-fire", "heal", "dominate-beast"), { type: "spells", spellIds: ["plant-growth", "reincarnate"], uses: { type: "perDay", times: 1 } }, text("Wildshape.")],
    unlocksActions: ["cast-spell"],
  }),
  archetype({
    name: "Archmage",
    categories: ["hero"],
    description: "A powerful spellcaster dedicated to the arcane arts.",
    tags: ["Spellcaster", "Arcane", "Researcher"],
    effects: [
      spells("charm", "greater-blast", "ray-of-enfeeblement", "haste"),
      { type: "spells", spellIds: ["teleport", "scry", "wish"], uses: { type: "perDay", times: 1 } },
      { type: "advantage", mode: "advantage", on: "saves", when: [{ when: "vsSpells" }] },
    ],
    unlocksActions: ["research", "cast-spell"],
  }),
  archetype({
    name: "Artificer",
    categories: ["hero"],
    description: "A master of invention who unlocks extraordinary capabilities in objects.",
    tags: ["Spellcaster", "Arcane", "Crafter"],
    effects: [spells("heal", "summon-construct", "dispel-magic"), { type: "augmentLimit", max: 4 }, text("Tinker: may attempt to create a construct.")],
    unlocksActions: ["craft", "research"],
  }),
  archetype({
    name: "Assassin",
    categories: ["hero"],
    description: "Hired killers, spies and bounty hunters who strike from the shadows.",
    tags: ["Stealthy"],
    visionRange: 1,
    effects: [
      text("Assassinate: once per turn deals an additional 14 damage. If it surprises the enemy, its first hit is an automatic critical hit."),
      { type: "advantage", mode: "advantage", on: "attacks", when: [{ when: "surprising" }, { when: "firstRound" }] },
      { type: "reduceDamage", mode: "halve", amount: 0, times: 1, per: "round" },
    ],
    unlocksActions: ["move-stealth", "spy"],
  }),
  archetype({
    name: "Bard",
    categories: ["hero"],
    description: "Weaves magic through words and music.",
    tags: ["Spellcaster"],
    effects: [
      spells("charm", "heal", "shatter", "sleep"),
      text("Inspiration: when an ally fails an attack or saving throw, add +4 to the roll, up to 4 times per combat."),
      { type: "advantage", mode: "advantage", on: "check:improvise", when: [] },
      text("Improviser: advantage on all Charisma checks."),
      text("Song of Rest: after a combat, all allied units regain double the Bard's Charisma modifier in hit points."),
    ],
  }),
  archetype({
    name: "Beastmaster",
    categories: ["hero"],
    description: "Excels alongside tamed beasts.",
    tags: ["Beastmaster"],
    effects: [
      { type: "advantage", mode: "advantage", on: "attacks", when: [{ when: "alliedWithTag", tag: "Beast" }] },
      { type: "advantage", mode: "advantage", on: "saves", when: [{ when: "alliedWithTag", tag: "Beast" }] },
      text("Beast Bond: may take the damage from attacks that would hit an allied beast."),
      text("Hunter's Mark: one target is marked at the start of combat and takes an extra 4 damage whenever this unit hits it."),
      text("Tracker: may use its free action to look for tracks of beasts or monstrosities (Wisdom check)."),
      { type: "advantage", mode: "advantage", on: "check:tame", when: [] },
      { type: "advantage", mode: "advantage", on: "check:capture", when: [] },
    ],
    unlocksActions: ["tame-beast", "store-beast", "retrieve-beast"],
  }),
  archetype({
    name: "Champion",
    categories: ["hero"],
    description: "Raw physical power honed to deadly perfection.",
    tags: ["Martial"],
    effects: [
      { type: "autoSucceedSave", times: 1, per: "combat" },
      text("Second Wind: once per combat, instead of attacking, regain half of its hit points."),
      text("Inspiring Leader: units travelling with the Champion get +1 movement if they end their movement with it."),
    ],
  }),
  archetype({
    name: "Necromancer",
    categories: ["hero"],
    description: "Wields the taboo forces of death.",
    tags: ["Necromancer", "Spellcaster", "Arcane", "Researcher"],
    effects: [
      spells("harm", "ray-of-sickness", "summon-undead"),
      text("Grim Harvest: regains hit points equal to its Intelligence modifier each time it deals damage."),
      { type: "raiseSlain", creatureType: "humanoid", asCreatureId: "zombie", times: 1, per: "combat" },
      text("Profane Ritual: sacrifice 6 undead units and make a DC 15 Intelligence check to create an Abomination."),
    ],
    unlocksActions: ["reanimate", "research"],
  }),
  archetype({
    name: "War Priest",
    categories: ["hero"],
    description: "A holy warrior who leads with words, deeds and violence.",
    tags: ["Spellcaster", "Divine"],
    effects: [
      spells("greater-heal", "smite", "ray-of-enfeeblement", "bless"),
      { type: "spells", spellIds: ["resurrection", "true-resurrection"], uses: { type: "perDay", times: 1 } },
      text("Lifebringer: once per turn, out of combat, use the Heal action for free to restore up to 20 + Wisdom hit points to a unit in the same region."),
    ],
    unlocksActions: ["cast-spell"],
  }),
];

const undead = (): Effect[] => [text("Undead: can only be healed with Gold, at double the cost (2 Gold heals 5 HP).")];
const construct = (): Effect[] => [text("Construct: can only be healed with Gold, at double the cost (2 Gold heals 5 HP).")];
const bound = (): Effect => text("Bound: ceases to function if not accompanying its creator, or if its creator dies in combat.");

export function utterdarkPreset() {
  const input: RulesetInput = {
    meta: {
      name: "Descent into the Utterdark",
      description:
        "Expand into a dangerous underground world: build outposts, keep your people fed and paid, and survive what lurks in the dark.",
      terminology: {},
      theme: { primaryColour: "#7c3aed", logoUrl: "" },
      attributions: [SRD_ATTRIBUTION],
    },
    settings: {
      actionSlots: 6,
      conditionalLimit: 2,
      maxAugmentsPerUnit: 3,
      freeActionsPerUnit: 1,
      movement: { milesPerDayAt30ft: 24, travelDaysPerRound: 1, defaultConnectionMiles: 12, forceMarchMultiplier: 2, stealthMultiplier: 0.5 },
      combat: { maxRounds: 10, usesReset: "round", retreatBelow: 0.25 },
      demolishRefund: 0.5,
      // "Each faction can have 1 event per turn."
      roundEvents: "all",
      // PLACEHOLDER costs by Challenge Rating, calibrated against the DM sheet's old unit prices.
      crCosts: [
        { category: "hero", maxCr: 30, cost: { gold: 20 }, upkeep: { gold: 8 } },
        { category: "monster", maxCr: 1, cost: {}, upkeep: { food: 1 } },
        { category: "monster", maxCr: 4, cost: {}, upkeep: { food: 2 } },
        { category: "monster", maxCr: 30, cost: {}, upkeep: { food: 5 } },
        { category: "any", maxCr: 0.125, cost: { gold: 2, growth: 5 }, upkeep: { gold: 2 } },
        { category: "any", maxCr: 0.5, cost: { gold: 4, growth: 10 }, upkeep: { gold: 2, food: 1 } },
        { category: "any", maxCr: 2, cost: { gold: 4, growth: 10 }, upkeep: { gold: 3, food: 1 } },
        { category: "any", maxCr: 30, cost: { gold: 5, growth: 15 }, upkeep: { gold: 4, food: 1 } },
      ],
    },

    resources: [
      // Starting amounts from the Master Tracker (ECO tab).
      { id: "gold", name: "Gold", icon: "🪙", colour: "#d4a017", kind: "stockpile", startingAmount: 30 },
      { id: "food", name: "Food", icon: "🍖", colour: "#16a34a", kind: "stockpile", startingAmount: 10 },
      { id: "growth", name: "Growth", icon: "🌱", colour: "#65a30d", kind: "stockpile", startingAmount: 25 },
      { id: "population", name: "Population", icon: "👥", colour: "#0ea5e9", kind: "stockpile", startingAmount: 5 },
    ],

    terrainTypes: [
      { id: "normal", name: "Normal" },
      { id: "difficult", name: "Difficult", costMultiplier: 2, bypassedByFlying: true, bypassedByNaturalExplorer: true },
      { id: "water", name: "Flooded", requiresMovement: ["swim", "fly"] },
      { id: "sheer", name: "Sheer shaft", requiresMovement: ["climb", "fly"] },
    ],

    settlementTiers: [
      {
        id: "outpost",
        name: "Outpost",
        description: "Built in an unclaimed region with no hostile units, containing at least one of your units.",
        upgradesFrom: null,
        cost: { gold: 5, growth: 25 },
        buildingSlots: 1,
        production: { gold: 1, growth: 5 },
        recruitCategories: ["standard"],
        requiresUnclaimed: true,
        requiresNoHostiles: true,
      },
      {
        id: "settlement",
        name: "Settlement",
        description: "For every settlement you construct, you must have at least 2 other outposts at the point of construction.",
        upgradesFrom: "outpost",
        cost: { gold: 15, growth: 50 },
        buildingSlots: 2,
        production: { gold: 2, growth: 10 },
        upkeep: { food: 1 },
        ratio: [{ tierId: "outpost", count: 2 }],
        recruitCategories: ["standard"],
      },
      {
        id: "city",
        name: "City",
        description: "For every city built, you must have at least 1 other settlement and 4 other outposts at the point of construction. Each city allows one more hero (your starting hero doesn't count).",
        upgradesFrom: "settlement",
        cost: { gold: 25, growth: 200 },
        buildingSlots: 3,
        production: { gold: 3, growth: 15 },
        upkeep: { food: 2 },
        ratio: [
          { tierId: "settlement", count: 1 },
          { tierId: "outpost", count: 4 },
        ],
        recruitCategories: ["standard", "hero"],
        heroLimit: 1,
      },
      {
        id: "capital",
        name: "Capital",
        description: "Same requirements as a City. Only one per faction.",
        upgradesFrom: "city",
        cost: { gold: 40, growth: 500 },
        buildingSlots: 4,
        production: { gold: 4, growth: 20 },
        upkeep: { food: 3 },
        maxPerTeam: 1,
        ratio: [
          { tierId: "settlement", count: 1 },
          { tierId: "outpost", count: 4 },
        ],
        recruitCategories: ["standard", "hero"],
        heroLimit: 1,
      },
    ],

    buildings: [
      {
        id: "academy",
        name: "Academy",
        description: "Units recruited in this region gain +2 to the ability score chosen when the Academy is built. Grants the Train in Academy action.",
        buildChoice: "ability",
        tiers: [{ cost: { gold: 12 }, upkeep: { gold: 2 }, effects: [{ type: "abilityChoiceBonus", amount: 2 }] }],
      },
      {
        id: "breeding-pits",
        name: "Breeding Pits",
        description: "Place a captured monster here. After a number of turns based on its CR, a new tamed unit is produced.",
        tiers: [
          {
            cost: { gold: 10 },
            effects: [
              { type: "storage", capacity: 1, tag: "monster" },
              text("Produces a new tamed copy of the stored monster after a number of turns based on its CR. Monster upkeep is Food equal to half its CR."),
            ],
          },
        ],
      },
      {
        id: "farm",
        name: "Farm",
        description: "Farms help sustain your population and armies.",
        tiers: [
          { cost: { gold: 4 }, upkeep: { gold: 3 }, production: { food: 2, growth: 5 } },
          { description: "Increased yield, for when you're tight on building space.", cost: { gold: 8 }, upkeep: { gold: 5 }, production: { food: 4, growth: 10 } },
          { description: "Increased yield, for when you're tight on building space.", cost: { gold: 12 }, upkeep: { gold: 7 }, production: { food: 6, growth: 15 } },
        ],
      },
      {
        id: "fortification",
        name: "Fortification",
        description: "Your units in this region gain AC and to-hit. Defenders get double.",
        tiers: [
          { cost: { gold: 8 }, effects: fortification(1) },
          { cost: { gold: 8 }, effects: fortification(2) },
          { cost: { gold: 8 }, effects: fortification(3) },
        ],
      },
      {
        id: "hunters-post",
        name: "Hunter's Post",
        description: "Hunters bring back food and sometimes craftable resources. Grants the Hunt free action.",
        tiers: [
          { cost: { gold: 6 }, upkeep: { gold: 2 }, production: { food: 1 }, effects: [{ type: "freeActions", actionTypeId: "hunt", uses: 1 }] },
          { cost: { gold: 6 }, upkeep: { gold: 3 }, production: { food: 2, growth: 5 }, effects: [{ type: "freeActions", actionTypeId: "hunt", uses: 1 }] },
          { cost: { gold: 6 }, upkeep: { gold: 4 }, production: { food: 3, growth: 10 }, effects: [{ type: "freeActions", actionTypeId: "hunt", uses: 1 }] },
        ],
      },
      {
        id: "market",
        name: "Market",
        description: "Swap Gold for Food or Food for Gold.",
        tiers: [
          {
            cost: { gold: 10 },
            production: { gold: 2 },
            effects: [
              {
                type: "exchange",
                rates: [
                  { give: { gold: 4 }, get: { food: 1 } },
                  { give: { food: 1 }, get: { gold: 2 } },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "menagerie",
        name: "Menagerie",
        description: "Stores up to 3 creatures. You still pay their Food upkeep.",
        tiers: [
          {
            cost: { gold: 10 },
            effects: [
              { type: "storage", capacity: 3, tag: "monster" },
              text("If this region is raided or attacked, the stored beasts are released and attack the intruders. They can't be retrieved except by a Beastmaster or suitable roleplay actions."),
            ],
          },
        ],
      },
      {
        id: "mine",
        name: "Mine",
        description: "Helps sustain and grow your economy.",
        tiers: [
          { cost: { gold: 8, growth: 15 }, upkeep: { food: 1 }, production: { gold: 6 } },
          { cost: { gold: 12, growth: 30 }, upkeep: { food: 2 }, production: { gold: 9 } },
          { cost: { gold: 16, growth: 45 }, upkeep: { food: 3 }, production: { gold: 12 } },
        ],
      },
      {
        id: "portal",
        name: "Portal",
        description: "Units can move through a portal to an adjoined portal as if it were an adjacent region.",
        tiers: [{ cost: { gold: 8 }, upkeep: { gold: 2 }, effects: [{ type: "freeActions", actionTypeId: "use-portal", uses: 1 }] }],
      },
      {
        id: "smithy",
        name: "Smithy",
        description: "Needed to craft augments. Grants the Craft free action (which can also research a recipe) once per turn per tier.",
        tiers: [
          { cost: { gold: 5 }, effects: [{ type: "freeActions", actionTypeId: "craft", uses: 1 }] },
          { cost: { gold: 5 }, effects: [{ type: "freeActions", actionTypeId: "craft", uses: 2 }] },
          { cost: { gold: 5 }, effects: [{ type: "freeActions", actionTypeId: "craft", uses: 3 }] },
        ],
      },
      {
        id: "tavern",
        name: "Tavern",
        description: "Rumours from your people and passers-by. Grants the Tavern Gossip free action.",
        tiers: [{ cost: { gold: 5 }, upkeep: { food: 1 }, production: { gold: 3, growth: 5 }, effects: [{ type: "freeActions", actionTypeId: "tavern-gossip", uses: 1 }] }],
      },
      {
        id: "temple",
        name: "Temple",
        description: "Grants Divine Intervention and Respite (restore up to 50 HP to units here each turn, or cast Resurrection instead).",
        tiers: [
          {
            cost: { gold: 18 },
            upkeep: { gold: 2, food: 1 },
            production: { growth: 10 },
            effects: [
              { type: "freeActions", actionTypeId: "divine-intervention", uses: 1 },
              { type: "freeActions", actionTypeId: "respite", uses: 1 },
            ],
          },
        ],
      },
      {
        id: "watchtower",
        name: "Watchtower",
        description: "Makes it hard for enemies to stay hidden here.",
        tiers: [
          { cost: { gold: 8 }, effects: [{ type: "stealthDc", dc: 13, enemyDisadvantage: true }] },
          { cost: { gold: 8 }, effects: [{ type: "stealthDc", dc: 14, enemyDisadvantage: true }, { type: "vision", range: 1 }] },
          { cost: { gold: 8 }, effects: [{ type: "stealthDc", dc: 15, enemyDisadvantage: true, adjacentDc: 13 }, { type: "vision", range: 1 }] },
        ],
      },
    ],

    // Races and their ability bonuses from the DM sheet (VALIDATION tab).
    races: SHEET_RACES,

    creatures: [
      // Recruitable units: plain SRD 5.2 stat blocks. The archetype chosen when
      // recruiting (Scout, Regiment, Defender…) gives them their role.
      srd("Guard", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Warrior Infantry", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Priest Acolyte", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Scout", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Tough", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Spy", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Druid", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Priest", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Berserker", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Warrior Veteran", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Knight", { category: "standard", recruitable: true, tags: ["Humanoid"] }),
      srd("Guard Captain", { category: "hero", recruitable: true, tags: ["Humanoid"] }),
      srd("Gladiator", { category: "hero", recruitable: true, tags: ["Humanoid"] }),
      srd("Mage", { category: "hero", recruitable: true, tags: ["Humanoid"] }),
      srd("Assassin", { category: "hero", recruitable: true, tags: ["Humanoid"] }),
      srd("Archmage", { category: "hero", recruitable: true, tags: ["Humanoid"] }),
      // Monster library
      srd("Zombie", { category: "monster", tags: ["Undead"], costOverride: {}, upkeepOverride: {}, effects: [...undead(), bound()] }),
      srd("Skeleton", { category: "monster", tags: ["Undead"], costOverride: {}, upkeepOverride: {}, effects: [...undead(), bound()] }),
      srd("Iron Golem", { category: "monster", tags: ["Construct"], costOverride: { gold: 110 }, upkeepOverride: { gold: 20 }, effects: construct(), description: "Can be created by an Artificer." }),
      srd("Shield Guardian", { category: "monster", tags: ["Construct"], costOverride: { gold: 60 }, upkeepOverride: { gold: 10 }, effects: [...construct(), text("Magically bound to an amulet.")], description: "Can be created by an Artificer." }),
      srd("Giant Lizard", { category: "monster", tags: ["Beast"] }),
      srd("Giant Spider", { category: "monster", tags: ["Beast"] }),
      srd("Giant Bat", { category: "monster", tags: ["Beast"] }),
      srd("Drider", { category: "monster", tags: ["Monstrosity"] }),
      srd("Ghoul", { category: "monster", tags: ["Undead"] }),
      srd("Gelatinous Cube", { category: "monster", tags: ["Ooze"] }),
      srd("Ochre Jelly", { category: "monster", tags: ["Ooze"] }),
      srd("Gray Ooze", { category: "monster", tags: ["Ooze"] }),
      srd("Otyugh", { category: "monster", tags: ["Aberration"] }),
      srd("Rust Monster", { category: "monster", tags: ["Monstrosity"] }),
      srd("Basilisk", { category: "monster", tags: ["Monstrosity"] }),
      srd("Grick", { category: "monster", tags: ["Aberration"] }),
      srd("Roper", { category: "monster", tags: ["Aberration"] }),
      srd("Darkmantle", { category: "monster", tags: ["Monstrosity"] }),
      srd("Violet Fungus", { category: "monster", tags: ["Plant"] }),
      srd("Purple Worm", { category: "monster", tags: ["Monstrosity"] }),
      // Everything else the encounter tables can spawn.
      ...encounterMonsters(),
    ],

    archetypes: ARCHETYPES,
    spells: SPELLS,

    itemCategories: [
      { id: "basic-material", name: "Basic Material" },
      { id: "material", name: "Material" },
      { id: "augment", name: "Augment", equippable: true },
      { id: "item", name: "Item" },
      { id: "trinket", name: "Trinket" },
      { id: "structure", name: "Structure or Trap", equippable: false },
    ],
    augmentSlots: [
      { id: "armour", name: "Armour" },
      { id: "consumable", name: "Consumable", maxPerUnit: 3 },
      { id: "equipment", name: "Equipment", maxPerUnit: 2 },
      { id: "shield", name: "Shield" },
      { id: "weapon-tool", name: "Weapon or Tool" },
    ],
    // Items, augments and recipes from the Master Tracker (AUG) and DM sheet (AUGMENTS).
    items: SHEET_ITEMS,
    recipes: SHEET_RECIPES,

    actionTypes: [
      // Numbered actions
      {
        id: "cast-spell",
        name: "Cast Spell",
        description: "Cast an out-of-combat spell, such as Scry, Teleport or Resurrection. You must have access to the spell, e.g. through an archetype or an item.",
        kind: "numbered",
        handler: "castSpell",
        inputs: [{ type: "unit", label: "Caster" }, { type: "spell" }, { type: "text", label: "Target unit or region" }],
      },
      {
        id: "claim",
        name: "Claim",
        description: "Claim a region controlled by another faction that has no enemy units in it. This ends any remaining movement of the units claiming it, and a stealthed unit becomes overt.",
        kind: "numbered",
        handler: "annex",
        config: { endsMovement: true, revealsStealth: true },
        requirements: [{ type: "regionOwner", owner: "other" }, { type: "noHostileUnits" }, { type: "ownUnitInRegion" }],
        inputs: [{ type: "region" }],
      },
      {
        id: "construct-building",
        name: "Construct Building",
        description: "Pay for and build a building in a region you own with a free building slot.",
        kind: "numbered",
        handler: "constructBuilding",
        requirements: [{ type: "regionOwner", owner: "self" }, { type: "freeSlot" }],
        inputs: [{ type: "region" }, { type: "building" }],
      },
      {
        id: "construct-outpost",
        name: "Construct Outpost",
        description: "Build an outpost in a region not owned by anyone, with no hostile units, and with at least one of your units or heroes in it.",
        kind: "numbered",
        handler: "constructSettlement",
        config: { tierId: "outpost" },
        requirements: [{ type: "regionOwner", owner: "unowned" }, { type: "noHostileUnits" }, { type: "ownUnitInRegion" }],
        inputs: [{ type: "region" }],
      },
      {
        id: "upgrade-settlement",
        name: "Upgrade Settlement",
        description: "Upgrade a settlement to its next tier (Outpost → Settlement → City → Capital), meeting that tier's requirements.",
        kind: "numbered",
        handler: "upgradeSettlement",
        requirements: [{ type: "regionOwner", owner: "self" }, { type: "settlementPresent" }],
        inputs: [{ type: "region" }],
      },
      {
        id: "demolish",
        name: "Demolish",
        description: "Demolish a building and salvage half its construction cost. You can't demolish a building on the turn it was built.",
        kind: "numbered",
        handler: "demolish",
        config: { notSameRoundAsBuilt: true },
        requirements: [{ type: "regionOwner", owner: "self" }],
        inputs: [{ type: "region" }, { type: "building" }],
      },
      {
        id: "excavate",
        name: "Excavate",
        description:
          "Your miners tunnel through the rock in a direction, possibly discovering new regions, resources or dangers. The miner must be in a region with a solid cavern wall. Free once per Miner each turn; use a numbered action to excavate again.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1, movementCost: 1 },
        requirements: [{ type: "unitWithTag", tag: "Miner" }, { type: "unitHasMovement" }],
        inputs: [{ type: "unit", tag: "Miner" }, { type: "text", label: "Direction" }],
        check: { abilities: ["str", "con"], tableId: "excavate" },
      },
      {
        id: "explore",
        name: "Explore",
        description:
          "Search a region for resources, a ruin or dungeon for treasure, or the region for hidden units. Units make an Intelligence or Wisdom check. A region and a ruin can only be searched once; searching for hidden units can find stealthed units and hidden monsters, which may start a fight.",
        kind: "numbered",
        handler: "rollCheck",
        config: {
          tablesByChoice: { Region: "search-region", Ruin: "search-ruin", Dungeon: "dungeon" },
          abilitiesByChoice: { Region: ["int", "wis"], Ruin: ["int", "wis"], Dungeon: ["int", "wis"], "Hidden units": ["wis"] },
          searchHiddenChoice: "Hidden units",
        },
        inputs: [{ type: "unit", multiple: true }, { type: "choice", label: "Search", options: ["Region", "Ruin", "Dungeon", "Hidden units"] }],
        check: { abilities: ["int", "wis"], tableId: "search-region" },
      },
      {
        id: "extract",
        name: "Extract",
        description: "A miner may extract a deposit with a STR or CON check. Alternatively, any unit may extract materials from a slain creature with a DEX or WIS check. Free once per unit each turn.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1, abilitiesByChoice: { Deposit: ["str", "con"], Corpse: ["dex", "wis"] } },
        inputs: [{ type: "unit", multiple: true }, { type: "choice", label: "Extract from", options: ["Deposit", "Corpse"] }, { type: "text", label: "Which deposit or corpse" }],
        check: { abilities: ["str", "con", "dex", "wis"], tableId: "extract" },
      },
      {
        id: "heal-unit",
        name: "Heal Unit",
        description: "Heal a unit in a friendly region: 5 HP per 1 Gold, or 10 HP per 1 Food. Alternatively heal with a Healer or War Priest.",
        kind: "numbered",
        handler: "heal",
        config: { rates: [{ resourceId: "gold", hpPer: 5 }, { resourceId: "food", hpPer: 10 }], minimumCost: 1 },
        inputs: [{ type: "unit" }, { type: "number", label: "Heal to HP", min: 1 }, { type: "resources", label: "Resources to spend" }],
      },
      {
        id: "improvise",
        name: "Improvise",
        description: "Describe something you want to do that no other action covers. You may need to make related rolls, e.g. a CHA check to inspire your people or an INT check to research something.",
        kind: "numbered",
        handler: "manual",
        inputs: [{ type: "text", label: "What do you do?" }, { type: "resources", label: "Resources committed" }],
      },
      {
        id: "move",
        name: "Move Units",
        description: "Move any number of units from the same region, up to the lowest movement among them. Moving into hostiles starts combat unless you say how you avoid it (not every combat can be avoided).",
        kind: "numbered",
        handler: "move",
        config: { mode: "normal" },
        requirements: [{ type: "unitHasMovement" }],
        inputs: [{ type: "unit", multiple: true }, { type: "path" }],
      },
      {
        id: "move-stealth",
        name: "Move Units – Stealth",
        description: "Units with stealthed movement travel up to half their movement. Each time they enter a region with units not owned by your faction, they make a DEX check against the highest passive Perception there.",
        kind: "numbered",
        handler: "move",
        config: { mode: "stealth" },
        requirements: [{ type: "unitWithTag", tag: "Stealthy" }, { type: "unitHasMovement" }],
        inputs: [{ type: "unit", multiple: true, tag: "Stealthy" }, { type: "path" }],
      },
      {
        id: "move-force-march",
        name: "Move Units – Force March",
        description: "Move units up to double the lowest movement among them. Any combat during this move is made at disadvantage for the force-marching units.",
        kind: "numbered",
        handler: "move",
        config: { mode: "forceMarch" },
        requirements: [{ type: "unitHasMovement" }],
        inputs: [{ type: "unit", multiple: true }, { type: "path" }],
      },
      {
        id: "attack",
        name: "Attack",
        description:
          "Attack a unit in the same region: from stealth, to start a fight with a faction's units, or to fight a monster that hasn't attacked you. Stealthed units that attack surprise the enemy: advantage on initiative and on their first attack. You only need this when a fight wouldn't start anyway: moving into a region with monsters starts one.",
        kind: "numbered",
        handler: "attack",
        inputs: [{ type: "unit", multiple: true }, { type: "targetUnit", label: "Target" }],
      },
      {
        id: "capture-monster",
        name: "Capture Monster",
        description:
          "Fight a known monster to capture it. Once it's below a quarter of its hit points and it's the only enemy left, your units try to capture it instead of attacking. A captured monster must be escorted to another region, released, or placed in a Breeding Pit or Menagerie before the end of the next round.",
        kind: "numbered",
        limit: { times: 1, per: "unit" },
        handler: "capture",
        inputs: [{ type: "unit", multiple: true }, { type: "targetUnit", label: "Monster", monstersOnly: true }],
      },
      {
        id: "raid",
        name: "Raid",
        description: "In a region controlled by another faction, steal half its Gold and Food production for the turn. If combat breaks out that turn, the raider has disadvantage on attacks. If it dies before the end of the turn, the goods are returned.",
        kind: "numbered",
        handler: "raid",
        config: { fraction: 0.5 },
        requirements: [{ type: "unitWithTag", tag: "Regiment" }, { type: "regionOwner", owner: "other" }],
        inputs: [{ type: "unit", tag: "Regiment" }, { type: "region" }],
      },
      {
        id: "reanimate",
        name: "Reanimate",
        description: "When the Necromancer is in a region containing a dead humanoid unit, raise it as a Zombie or a Skeleton.",
        kind: "numbered",
        handler: "reanimate",
        config: { creatureIds: ["zombie", "skeleton"] },
        requirements: [{ type: "unitWithTag", tag: "Necromancer" }],
        inputs: [{ type: "unit", tag: "Necromancer" }, { type: "choice", label: "Raise as", options: ["Zombie", "Skeleton"] }],
      },
      {
        id: "recruit",
        name: "Recruit Unit",
        description: "Pay for and recruit a unit in a region you control, choosing its race and archetype.",
        kind: "numbered",
        handler: "recruit",
        requirements: [{ type: "regionOwner", owner: "self" }, { type: "settlementPresent" }],
        inputs: [{ type: "region" }, { type: "creature" }, { type: "race" }, { type: "archetype" }],
      },
      {
        id: "spy",
        name: "Spy",
        description:
          "A stealthed unit learns about the region it's in and makes an Insight check against the most powerful target there: DC 10 equipment; DC 15 equipment and stats; DC 20 equipment, stats and max HP. Free once per unit each turn.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1 },
        requirements: [{ type: "unitWithTag", tag: "Stealthy" }, { type: "unitStealthed" }],
        inputs: [{ type: "unit", tag: "Stealthy" }],
        check: { abilities: ["int", "wis", "cha"], tableId: "spy" },
      },
      {
        id: "train-academy",
        name: "Train in Academy",
        description: "Train a unit or hero in a region with an Academy to gain that Academy's benefit. A unit can only have the effect of one Academy.",
        kind: "numbered",
        handler: "train",
        requirements: [{ type: "buildingInRegion", buildingId: "academy" }],
        inputs: [{ type: "unit" }],
      },
      {
        id: "train-population",
        name: "Train Population",
        description: "Spend 100 Growth to train non-combatant population into combat-ready population: gain +1 Population of your base race.",
        kind: "numbered",
        handler: "convert",
        cost: { growth: 100 },
        config: { gain: { population: 1 } },
      },
      {
        id: "upgrade-building",
        name: "Upgrade Building",
        description: "Upgrade a building you've already built to its next tier.",
        kind: "numbered",
        handler: "upgradeBuilding",
        requirements: [{ type: "regionOwner", owner: "self" }],
        inputs: [{ type: "region" }, { type: "building" }],
      },
      // Free actions
      { id: "apply-augment", name: "Apply Augment", description: "Equip an augment from your inventory on a unit. You can't unequip an item and equip it on another unit in the same turn.", kind: "free", handler: "applyAugment", inputs: [{ type: "unit" }, { type: "item" }] },
      {
        id: "craft",
        name: "Craft",
        description: "Craft one item you have the materials and recipe for, or research how to make an item you know of. Uses come from Smithies (and Artificers).",
        kind: "free",
        handler: "craft",
        config: { researchDice: "1d4" },
        inputs: [{ type: "choice", label: "Craft or research", options: ["Craft", "Research"] }, { type: "recipe" }, { type: "item" }],
      },
      {
        id: "disband",
        name: "Disband Unit",
        description: "Disband a unit in a region you control. Its augments return to your inventory. It can't be disbanded on the turn it was recruited. If it has more than half its maximum HP, you regain one Population.",
        kind: "free",
        handler: "disband",
        config: { refundIfAboveHalfHp: { population: 1 } },
        requirements: [{ type: "regionOwner", owner: "self" }],
        inputs: [{ type: "unit" }],
      },
      { id: "divine-intervention", name: "Divine Intervention", description: "Describe the help you seek and from which god. Should your prayer be heard, your deity will help: guidance or a direct boon. Uses come from Temples.", kind: "free", handler: "rollCheck", inputs: [{ type: "text", label: "Your prayer" }], check: { abilities: ["wis"], tableId: "divine-intervention" } },
      { id: "hunt", name: "Hunt", description: "Your hunters have a chance to bring back additional resources. Uses come from Hunter's Posts.", kind: "free", handler: "rollCheck", inputs: [], check: { abilities: ["wis"], tableId: "hunters-post" } },
      { id: "research", name: "Research", description: "Study a material or item in your inventory to try to learn a crafting recipe it's used in. Researcher units can do this once per turn in friendly territory.", kind: "free", limit: { times: 1, per: "unit" }, handler: "research", config: { researchDice: "1d4" }, inputs: [{ type: "unit" }, { type: "item" }] },
      { id: "respite", name: "Respite", description: "The temple restores up to 50 hit points, shared among units in its region. Instead, you can cast Resurrection through the Temple.", kind: "free", handler: "heal", config: { poolHp: 50 }, inputs: [{ type: "unit", multiple: true }] },
      { id: "retrieve-beast", name: "Retrieve Beast", description: "Retrieve a stored beast from a Menagerie. If you already have a beast companion, it's swapped.", kind: "free", limit: { times: 1, per: "unit" }, handler: "retrieveBeast", requirements: [{ type: "buildingInRegion", buildingId: "menagerie" }], inputs: [{ type: "unit", tag: "Beastmaster" }, { type: "text", label: "Beast" }] },
      { id: "store-beast", name: "Store Beast", description: "Store a tamed beast in a Menagerie. Your Beastmaster must be in the Menagerie's region.", kind: "free", limit: { times: 1, per: "unit" }, handler: "storeBeast", requirements: [{ type: "unitWithTag", tag: "Beastmaster" }, { type: "buildingInRegion", buildingId: "menagerie" }], inputs: [{ type: "unit", tag: "Beastmaster" }] },
      {
        id: "tame-beast",
        name: "Tame Beast",
        description: "When the Beastmaster enters a region with a beast, it tries to tame it before combat. On a success it must stay there the rest of the turn; on a failure the beast may flee, or attack on a bad failure.",
        kind: "free",
        limit: { times: 1, per: "unit" },
        handler: "tame",
        requirements: [{ type: "unitWithTag", tag: "Beastmaster" }],
        inputs: [{ type: "unit", tag: "Beastmaster" }, { type: "text", label: "Beast" }],
      },
      { id: "tavern-gossip", name: "Tavern Gossip", description: "A chance to learn interesting gossip from your own people or far-travellers. Uses come from Taverns.", kind: "free", handler: "rollCheck", inputs: [], check: { abilities: ["cha"], tableId: "tavern" } },
      { id: "use-market", name: "Use Market", description: "Exchange 4 Gold for 1 Food, or 1 Food for 2 Gold. Requires a Market.", kind: "free", handler: "market", requirements: [{ type: "text", text: "You own a Market" }], inputs: [{ type: "resources", label: "Exchange" }] },
      { id: "use-portal", name: "Use Portal", description: "Move units through a portal to a connected portal, your own Portal elsewhere, or a portal you've been given access to.", kind: "free", handler: "portal", requirements: [{ type: "buildingInRegion", buildingId: "portal" }], inputs: [{ type: "unit", multiple: true }, { type: "region", label: "Destination" }] },
      { id: "use-resource", name: "Use Resource", description: "Use an item outside combat, or convert items into materials or income.", kind: "free", handler: "useItem", inputs: [{ type: "item" }, { type: "text", label: "How" }] },
    ],

    rollTables: [
      // From the Master Tracker's DM REFERENCE tab, plus the encounter tables from the DM sheet.
      ...SHEET_TABLES,
      ...ENCOUNTER_TABLES,
      {
        id: "dungeon",
        name: "Dungeon",
        category: "check",
        modifierNote: "+ the best INT or WIS modifier among the exploring units",
        bands: [
          band(1, 7, `A trap springs. (${P})`, [{ type: "damageActor", dice: "2d6" }]),
          band(8, 14, `Guardians attack! (${P})`, [{ type: "rollTable", tableId: "encounter-low" }]),
          band(15, null, `Treasure. (${P})`, [{ type: "rollTable", tableId: "treasure-uncommon" }]),
        ],
      },
    ],

    rulesSections: [
      {
        id: "overview",
        title: "How a round works",
        body: "A round usually lasts a real-life week. Roleplay with teams you've met on Discord and submit your orders here. At the end of the week the DMs resolve every team's actions, slot by slot, and the next round begins.",
      },
      {
        id: "goal",
        title: "Your goal",
        body: "Expand by building outposts in unclaimed lands, support the people who survived the collapse, and protect them from the monsters in the dark. Each team also has its own secret goals.",
      },
      {
        id: "units",
        title: "Units",
        body: "These stats represent a unit in its base form. The race of the unit, its archetype, its level of experience, and any items equipped may adjust its stats. Each unit can use a maximum of 1 free action per turn. You can recruit 1 additional hero per city in your empire; your starting hero isn't included in this rule.",
      },
      {
        id: "economy",
        title: "Economy",
        body: "Gold is your currency and your ability to motivate your people. Food feeds your workers and units. Growth is your ability to expand: surplus supplies, building materials and population. If you end a round with a negative resource, some of the actions that caused it may not resolve, random events may punish your reckless spending, units may disband and your people may revolt.",
      },
      {
        id: "diplomacy",
        title: "Diplomatic agreements",
        body: [
          "Map Sharing: parties share their maps each turn for a set number of turns.",
          "Recurring Trade: a specific trade goes through every turn for a set number of turns.",
          "Non-Aggression Pact: parties don't act aggressively towards each other while the pact lasts.",
          "Open Borders: units may travel safely through each other's borders.",
          "Defensive Pact: parties publicly declare war on any aggressor against a member.",
          "Military Alliance: parties coordinate military activity.",
          "Unit Loan: a unit can be commanded by another faction for a set number of turns.",
          "Confederation: one faction is incorporated into another; the players become a single team.",
        ].join("\n"),
      },
    ],
  };
  return Ruleset.parse(input);
}
