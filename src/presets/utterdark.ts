import type { Effect } from "@/engine/ruleset/effects";
import type { z } from "zod";
import { Ruleset, TableResult as TableResultSchema, type RulesetInput } from "@/engine/ruleset/ruleset";
import { SRD_ATTRIBUTION, srdByName } from "@/engine/srd/library";

// "Descent into the Utterdark", built from reference/utterdark-rules.md.
// Anything marked PLACEHOLDER isn't in the rules document and waits for the
// DM sheet (roll tables, races, augments, recipes, settlement Growth).
// See docs/utterdark-preset.md for the rules that can only be "text only".

const P = "PLACEHOLDER — replace with the DM sheet values.";

type CreatureInput = NonNullable<RulesetInput["creatures"]>[number];

function srd(
  id: string,
  srdName: string,
  extra: Omit<Partial<CreatureInput>, "statBlock" | "source" | "id"> & Pick<CreatureInput, "category">,
  rename?: string,
): CreatureInput {
  const m = srdByName(srdName);
  return {
    id,
    source: { kind: "srd-2024", ref: m.index },
    statBlock: rename ? { ...m.statBlock, name: rename } : m.statBlock,
    ...extra,
  };
}

type Modifier = Extract<Effect, { type: "modifier" }>;
const modifier = (target: string, value: number, extra: Partial<Modifier> = {}): Modifier => ({
  type: "modifier",
  target,
  value,
  when: [],
  ...extra,
});

const fortification = (n: number) => [
  modifier("ac", n, { tagMultiplier: { tag: "Defender", factor: 2 } }),
  modifier("toHit", n, { tagMultiplier: { tag: "Defender", factor: 2 } }),
];

type TableResult = z.input<typeof TableResultSchema>;
const band = (min: number, max: number | null, text: string, results: TableResult[] = []) => ({ min, max, text, results });

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
      movement: { milesPerDayAt30ft: 24, travelDaysPerRound: 1, defaultConnectionMiles: 12, forceMarchMultiplier: 2, stealthMultiplier: 0.5 },
      combat: { maxRounds: 10, unitFootprintFt: 30, usesReset: "round" },
      demolishRefund: 0.5,
      // PLACEHOLDER costs by Challenge Rating, calibrated against the old unit prices.
      crCosts: [
        { category: "hero", maxCr: 4, cost: { gold: 15 }, upkeep: { gold: 6 } },
        { category: "hero", maxCr: 8, cost: { gold: 20 }, upkeep: { gold: 8 } },
        { category: "hero", maxCr: 30, cost: { gold: 25 }, upkeep: { gold: 10 } },
        { category: "monster", maxCr: 1, cost: {}, upkeep: { food: 1 } },
        { category: "monster", maxCr: 4, cost: {}, upkeep: { food: 2 } },
        { category: "monster", maxCr: 30, cost: {}, upkeep: { food: 5 } },
        { category: "any", maxCr: 0.125, cost: { gold: 2, growth: 5 }, upkeep: { gold: 2 } },
        { category: "any", maxCr: 0.5, cost: { gold: 4, growth: 10 }, upkeep: { gold: 2, food: 1 } },
        { category: "any", maxCr: 2, cost: { gold: 5, growth: 12 }, upkeep: { gold: 3, food: 1 } },
        { category: "any", maxCr: 4, cost: { gold: 5, growth: 15 }, upkeep: { gold: 4, food: 1 } },
        { category: "any", maxCr: 8, cost: { gold: 8, growth: 20 }, upkeep: { gold: 5, food: 2 } },
        { category: "any", maxCr: 30, cost: { gold: 12, growth: 25 }, upkeep: { gold: 6, food: 2 } },
      ],
    },

    resources: [
      { id: "gold", name: "Gold", icon: "🪙", colour: "#d4a017", kind: "stockpile", startingAmount: 10 },
      { id: "food", name: "Food", icon: "🍖", colour: "#16a34a", kind: "stockpile", startingAmount: 5 },
      { id: "growth", name: "Growth", icon: "🌱", colour: "#65a30d", kind: "stockpile", startingAmount: 10 },
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
        description: `Built in an unclaimed region with no hostile units. Growth production is a ${P}`,
        upgradesFrom: null,
        cost: { gold: 5 },
        discounts: [{ when: "ruinPresent", amount: { gold: 3 } }],
        buildingSlots: 1,
        production: { growth: 2 },
        recruitCategories: ["standard"],
        requiresUnclaimed: true,
        requiresNoHostiles: true,
      },
      {
        id: "settlement",
        name: "Settlement",
        description: `Built in a region containing an Outpost. Growth production is a ${P}`,
        upgradesFrom: "outpost",
        cost: { gold: 15 },
        buildingSlots: 2,
        production: { growth: 4 },
        recruitCategories: ["standard"],
      },
      {
        id: "city",
        name: "City",
        description: `Built in a region containing a Settlement. Allows one hero per city. Growth production is a ${P}`,
        upgradesFrom: "settlement",
        cost: { gold: 25 },
        buildingSlots: 3,
        production: { growth: 6 },
        recruitCategories: ["standard", "hero"],
        heroLimit: 1,
      },
      {
        id: "capital",
        name: "Capital",
        description: `Built in a region containing a City. Only one per faction. Growth production is a ${P}`,
        upgradesFrom: "city",
        cost: { gold: 40 },
        buildingSlots: 4,
        production: { growth: 8 },
        maxPerTeam: 1,
        recruitCategories: ["standard", "hero"],
        heroLimit: 1,
      },
    ],

    buildings: [
      {
        id: "academy",
        name: "Academy",
        description: "Units recruited in this region gain +2 to an ability score, chosen when the Academy is built.",
        buildChoice: "ability",
        tiers: [{ cost: { gold: 12 }, upkeep: { gold: 2 }, effects: [{ type: "abilityChoiceBonus", amount: 2 }] }],
      },
      {
        id: "breeding-pits",
        name: "Breeding Pits",
        description: "Place a captured monster here. After a number of rounds based on its CR, a new tamed unit is produced.",
        tiers: [
          {
            cost: { gold: 10 },
            upkeep: { gold: 2 },
            effects: [
              { type: "storage", capacity: 1, tag: "monster" },
              { type: "text", text: "Produces a new tamed copy of the stored monster after a number of rounds based on its CR. Monster upkeep is Food equal to half its CR." },
            ],
          },
        ],
      },
      {
        id: "farm",
        name: "Farm",
        description: "Farms sustain your population and armies.",
        tiers: [
          { cost: { gold: 4 }, upkeep: { gold: 3 }, production: { food: 2, growth: 5 } },
          { description: "Increased yield, for when you're tight on space.", cost: { gold: 10 }, upkeep: { gold: 5 }, production: { food: 3, growth: 10 } },
          { description: "High-density farming.", cost: { gold: 18 }, upkeep: { gold: 7 }, production: { food: 4, growth: 15 } },
        ],
      },
      {
        id: "fortification",
        name: "Fortification",
        description: "Your units in this region gain AC and to-hit. Units with the Defender tag (Guards) get double.",
        tiers: [
          { cost: { gold: 8 }, upkeep: { gold: 2 }, effects: fortification(1) },
          { cost: { gold: 16 }, upkeep: { gold: 3 }, effects: fortification(2) },
          { cost: { gold: 24 }, upkeep: { gold: 4 }, effects: fortification(3) },
        ],
      },
      {
        id: "hunter-post",
        name: "Hunter Post",
        description: "Hunters bring back food and sometimes craftable resources.",
        tiers: [
          { cost: { gold: 6 }, upkeep: { gold: 2 }, production: { food: 1 }, effects: [{ type: "rollEachRound", tableId: "hunters-post" }] },
          { cost: { gold: 6 }, upkeep: { gold: 3 }, production: { food: 2, growth: 5 }, effects: [{ type: "rollEachRound", tableId: "hunters-post" }] },
          { cost: { gold: 6 }, upkeep: { gold: 4 }, production: { food: 3, growth: 10 }, effects: [{ type: "rollEachRound", tableId: "hunters-post" }] },
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
        description: "Stores up to 3 monsters. You still pay their Food upkeep.",
        tiers: [
          {
            cost: { gold: 10 },
            upkeep: { gold: 1 },
            effects: [
              { type: "storage", capacity: 3, tag: "monster" },
              { type: "text", text: "If this region is raided or attacked, the stored beasts are released and attack the intruders. They can't be retrieved except by a Beastmaster or suitable actions." },
            ],
          },
        ],
      },
      {
        id: "mine",
        name: "Mine",
        description: "Helps sustain and grow your economy.",
        tiers: [
          { cost: { gold: 8 }, upkeep: { food: 1 }, production: { gold: 6 } },
          { cost: { gold: 14 }, upkeep: { food: 2 }, production: { gold: 9 } },
          { cost: { gold: 20 }, upkeep: { food: 3 }, production: { gold: 12 } },
        ],
      },
      {
        id: "portal",
        name: "Portal",
        description: "Grants the Use Portal action.",
        tiers: [
          { cost: { gold: 4 }, upkeep: { gold: 3 }, effects: [{ type: "portal", unitsPerAction: 1 }] },
          { cost: { gold: 5 }, upkeep: { gold: 4 }, effects: [{ type: "portal", unitsPerAction: 2 }] },
          { cost: { gold: 6 }, upkeep: { gold: 5 }, effects: [{ type: "portal", unitsPerAction: 3 }] },
        ],
      },
      {
        id: "smithy",
        name: "Smithy",
        description: "Grants the Craft/Research free action.",
        tiers: [
          { cost: { gold: 5 }, effects: [{ type: "freeActions", actionTypeId: "craft-research", uses: 1 }] },
          { cost: { gold: 5 }, effects: [{ type: "freeActions", actionTypeId: "craft-research", uses: 2 }] },
          { cost: { gold: 5 }, effects: [{ type: "freeActions", actionTypeId: "craft-research", uses: 3 }] },
        ],
      },
      {
        id: "tavern",
        name: "Tavern",
        description: "Rumours and stories from your people and passers-by.",
        tiers: [{ cost: { gold: 5 }, upkeep: { food: 1 }, production: { gold: 3, growth: 5 }, effects: [{ type: "rollEachRound", tableId: "tavern" }] }],
      },
      {
        id: "temple",
        name: "Temple",
        description: "Grants Divine Intervention once per round, and heals one unit in this region to full HP each round.",
        tiers: [
          {
            cost: { gold: 18 },
            upkeep: { gold: 2, food: 1 },
            production: { growth: 10 },
            effects: [
              { type: "freeActions", actionTypeId: "divine-intervention", uses: 1 },
              { type: "freeHeal", units: 1 },
            ],
          },
        ],
      },
      {
        id: "watchtower",
        name: "Watchtower",
        description: "Makes it hard for enemies to stay hidden here.",
        tiers: [
          { cost: { gold: 8 }, upkeep: { gold: 2 }, effects: [{ type: "stealthDc", dc: 13, enemyDisadvantage: true }] },
          { cost: { gold: 8 }, upkeep: { gold: 3 }, effects: [{ type: "stealthDc", dc: 14, enemyDisadvantage: true }, { type: "vision", range: 1 }] },
          {
            cost: { gold: 8 },
            upkeep: { gold: 4 },
            effects: [{ type: "stealthDc", dc: 15, enemyDisadvantage: true, adjacentDc: 13 }, { type: "vision", range: 1 }],
          },
        ],
      },
    ],

    races: [
      { id: "human", name: "Human", description: P, abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } },
      { id: "dwarf", name: "Dwarf", description: P, abilityBonuses: { con: 2, str: 1 } },
      { id: "elf", name: "Elf", description: P, abilityBonuses: { dex: 2, wis: 1 } },
      { id: "drow", name: "Drow", description: P, abilityBonuses: { dex: 2, cha: 1 } },
      { id: "duergar", name: "Duergar", description: P, abilityBonuses: { con: 2, str: 1 } },
      { id: "deep-gnome", name: "Deep Gnome", description: P, abilityBonuses: { int: 2, dex: 1 } },
      { id: "orc", name: "Orc", description: P, abilityBonuses: { str: 2, con: 1 } },
      { id: "halfling", name: "Halfling", description: P, abilityBonuses: { dex: 2, cha: 1 } },
    ],

    creatures: [
      // Standard units
      srd("guard", "Guard", {
        category: "standard",
        recruitable: true,
        tags: ["Guard", "Defender", "Martial", "Humanoid"],
        description: "Benefits greatly from fortifications and is good at finding hidden units.",
        effects: [
          { type: "advantage", mode: "advantage", on: "check:search", when: [] },
          { type: "text", text: "Vigilant: negates additional damage dealt by hidden units." },
        ],
      }),
      srd("healer", "Priest Acolyte", {
        category: "standard",
        recruitable: true,
        tags: ["Healer", "Spellcaster", "Humanoid"],
        description: "Heals one unit to full HP for free with the Heal Unit action, anywhere.",
      }, "Healer"),
      srd("mage", "Mage", { category: "standard", recruitable: true, tags: ["Spellcaster", "Humanoid"], description: "A glass cannon with high firepower." }),
      srd("miner", "Tough", {
        category: "standard",
        recruitable: true,
        tags: ["Miner", "Humanoid"],
        description: "Not made for combat, but excavates new passages and extracts deposits.",
        unlocksActions: ["excavate", "extract-deposit"],
      }, "Miner"),
      srd("regiment", "Warrior Veteran", {
        category: "standard",
        recruitable: true,
        tags: ["Regiment", "Martial", "Humanoid"],
        description: "A large body of trained soldiers. Needed to annex enemy territory.",
      }, "Regiment"),
      srd("scout", "Scout", {
        category: "standard",
        recruitable: true,
        tags: ["Stealthy", "Scout", "Humanoid"],
        description: "Moves stealthily, spies and sees into adjacent regions.",
        visionRange: 1,
        unlocksActions: ["move-stealth", "spy"],
      }),
      // Heroes
      srd("archmage", "Archmage", { category: "hero", recruitable: true, tags: ["Spellcaster", "Humanoid"], unlocksActions: ["teleport"] }),
      srd("assassin", "Assassin", {
        category: "hero",
        recruitable: true,
        tags: ["Stealthy", "Humanoid"],
        visionRange: 1,
        unlocksActions: ["move-stealth", "spy"],
      }),
      srd("beastmaster", "Druid", {
        category: "hero",
        recruitable: true,
        tags: ["Beastmaster", "Humanoid"],
        description: "No SRD beastmaster exists, so this uses the Druid stat block.",
        unlocksActions: ["tame-beast", "store-beast", "swap-retrieve-beast"],
        effects: [
          { type: "advantage", mode: "advantage", on: "check:tame", when: [] },
          { type: "advantage", mode: "advantage", on: "check:capture", when: [] },
        ],
      }, "Beastmaster"),
      srd("champion", "Gladiator", { category: "hero", recruitable: true, tags: ["Martial", "Humanoid"] }, "Champion"),
      srd("necromancer", "Mage", {
        category: "hero",
        recruitable: true,
        tags: ["Necromancer", "Spellcaster", "Humanoid"],
        description: "No SRD necromancer exists, so this uses the Mage stat block.",
        unlocksActions: ["reanimate"],
        effects: [{ type: "raiseSlain", creatureType: "humanoid", asCreatureId: "zombie", times: 1, per: "combat" }],
      }, "Necromancer"),
      srd("war-priest", "Priest", {
        category: "hero",
        recruitable: true,
        tags: ["Spellcaster", "Divine", "Humanoid"],
        effects: [{ type: "advantage", mode: "advantage", on: "check:divine-intervention", when: [] }],
      }, "War Priest"),
      // Monster library
      srd("zombie", "Zombie", { category: "monster", tags: ["Undead"], costOverride: {}, upkeepOverride: {} }),
      srd("skeleton", "Skeleton", { category: "monster", tags: ["Undead"], costOverride: {}, upkeepOverride: {} }),
      srd("giant-lizard", "Giant Lizard", { category: "monster", tags: ["Beast"] }),
      srd("giant-spider", "Giant Spider", { category: "monster", tags: ["Beast"], harvest: [{ itemId: "spider-silk", qty: 2 }] }),
      srd("giant-bat", "Giant Bat", { category: "monster", tags: ["Beast"] }),
      srd("drider", "Drider", { category: "monster", tags: ["Monstrosity"], harvest: [{ itemId: "spider-silk", qty: 3 }] }),
      srd("ghoul", "Ghoul", { category: "monster", tags: ["Undead"] }),
      srd("gelatinous-cube", "Gelatinous Cube", { category: "monster", tags: ["Ooze"] }),
      srd("ochre-jelly", "Ochre Jelly", { category: "monster", tags: ["Ooze"] }),
      srd("gray-ooze", "Gray Ooze", { category: "monster", tags: ["Ooze"] }),
      srd("otyugh", "Otyugh", { category: "monster", tags: ["Aberration"] }),
      srd("rust-monster", "Rust Monster", { category: "monster", tags: ["Monstrosity"] }),
      srd("basilisk", "Basilisk", { category: "monster", tags: ["Monstrosity"] }),
      srd("grick", "Grick", { category: "monster", tags: ["Aberration"] }),
      srd("roper", "Roper", { category: "monster", tags: ["Aberration"] }),
      srd("darkmantle", "Darkmantle", { category: "monster", tags: ["Monstrosity"] }),
      srd("violet-fungus", "Violet Fungus", { category: "monster", tags: ["Plant"] }),
      srd("purple-worm", "Purple Worm", { category: "monster", tags: ["Monstrosity"] }),
    ],

    itemCategories: [
      { id: "basic-material", name: "Basic Material" },
      { id: "material", name: "Material" },
      { id: "item", name: "Item" },
      { id: "trinket", name: "Trinket" },
      { id: "augment", name: "Augment", equippable: true },
    ],
    augmentSlots: [
      { id: "armour", name: "Armour" },
      { id: "consumable", name: "Consumable" },
      { id: "equipment", name: "Equipment" },
      { id: "shield", name: "Shield" },
      { id: "weapon-tool", name: "Weapon or Tool" },
    ],
    items: [
      { id: "metal", name: "Metal", categoryId: "basic-material", description: P },
      { id: "wood", name: "Wood", categoryId: "basic-material", description: P },
      { id: "gemstone", name: "Gemstone", categoryId: "basic-material", description: P },
      { id: "spider-silk", name: "Spider Silk", categoryId: "material", description: P },
      { id: "pristine-bones", name: "Pristine Bones", categoryId: "material", description: "Used by a Necromancer to raise a Skeleton." },
      {
        id: "pickaxes",
        name: "Pickaxes",
        categoryId: "augment",
        slotId: "weapon-tool",
        description: P,
        requiresUnitTags: ["Miner"],
        effects: [modifier("check:excavate", 1), modifier("check:extract-deposit", 1)],
      },
      { id: "chain-shirt", name: "Chain Shirt", categoryId: "augment", slotId: "armour", description: P, effects: [modifier("ac", 1)] },
      {
        id: "tower-shield",
        name: "Tower Shield",
        categoryId: "augment",
        slotId: "shield",
        description: P,
        requiresUnitTags: ["Martial"],
        effects: [modifier("ac", 2)],
      },
      {
        id: "silk-cloak",
        name: "Silk Cloak",
        categoryId: "augment",
        slotId: "equipment",
        description: P,
        effects: [{ type: "advantage", mode: "advantage", on: "check:stealth", when: [] }],
      },
      {
        id: "healing-draught",
        name: "Healing Draught",
        categoryId: "augment",
        slotId: "consumable",
        description: P,
        consumable: true,
        effects: [
          {
            type: "grantAction",
            action: {
              name: "Drink Healing Draught",
              text: "The unit regains 2d4 + 2 hit points.",
              uses: { type: "perCombat", times: 1 },
              profile: { kind: "heal", dice: "2d4", ability: null, flat: 2, targets: 1, revive: false },
              review: "auto",
            },
          },
        ],
      },
    ],
    recipes: [
      { id: "pickaxes", inputs: [{ itemId: "metal", qty: 2 }, { itemId: "wood", qty: 1 }], outputs: [{ itemId: "pickaxes", qty: 1 }], knownAtStart: true },
      { id: "chain-shirt", inputs: [{ itemId: "metal", qty: 3 }], outputs: [{ itemId: "chain-shirt", qty: 1 }], knownAtStart: true },
      { id: "tower-shield", inputs: [{ itemId: "metal", qty: 2 }, { itemId: "wood", qty: 2 }], outputs: [{ itemId: "tower-shield", qty: 1 }] },
      { id: "silk-cloak", inputs: [{ itemId: "spider-silk", qty: 2 }], outputs: [{ itemId: "silk-cloak", qty: 1 }] },
    ],

    actionTypes: [
      // Numbered actions
      {
        id: "annex",
        name: "Annex Region",
        description: "Claim a region already claimed by another team. It must contain no enemy units and one of your Regiments.",
        kind: "numbered",
        handler: "annex",
        requirements: [{ type: "regionOwner", owner: "other" }, { type: "noHostileUnits" }, { type: "unitWithTag", tag: "Regiment" }],
        inputs: [{ type: "region" }],
      },
      {
        id: "attack",
        name: "Attack",
        description:
          "Attack a unit in the same region: from stealth, against a neutral or friendly unit, or against a monster that hasn't attacked you. Surprising the enemy gives advantage on initiative and the first attack. Not needed when moving into hostile units, since that starts combat anyway.",
        kind: "numbered",
        handler: "attack",
        inputs: [{ type: "unit", multiple: true, label: "Attackers" }, { type: "text", label: "Target" }],
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
        description: "Build an outpost in an unclaimed region with no hostile units. Costs 3 less if a Ruin is present.",
        kind: "numbered",
        handler: "constructSettlement",
        config: { tierId: "outpost" },
        requirements: [{ type: "regionOwner", owner: "unowned" }, { type: "noHostileUnits" }],
        inputs: [{ type: "region" }],
      },
      {
        id: "upgrade-settlement",
        name: "Upgrade Settlement",
        description: "Upgrade a settlement to its next tier (Outpost → Settlement → City → Capital).",
        kind: "numbered",
        handler: "upgradeSettlement",
        requirements: [{ type: "regionOwner", owner: "self" }, { type: "settlementPresent" }],
        inputs: [{ type: "region" }],
      },
      {
        id: "demolish",
        name: "Demolish",
        description: "Demolish a building and salvage half its construction cost. No upkeep is paid for it this round.",
        kind: "numbered",
        handler: "demolish",
        requirements: [{ type: "regionOwner", owner: "self" }],
        inputs: [{ type: "region" }, { type: "building" }],
      },
      {
        id: "excavate",
        name: "Excavate",
        description:
          "Dig a tunnel in a direction. It may open a new region, uncover resources or reveal dangers. The miner uses 1 region of movement. One free use per Miner each round, plus one more as a numbered action.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1, movementCost: 1 },
        requirements: [{ type: "unitWithTag", tag: "Miner" }, { type: "unitHasMovement" }],
        inputs: [{ type: "unit", tag: "Miner" }, { type: "text", label: "Direction" }],
        check: { abilities: ["str", "con"], tableId: "excavate" },
      },
      {
        id: "extract-deposit",
        name: "Extract Deposit",
        description: "Extract resources from a known deposit with a Strength or Constitution check. One free use per Miner each round.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1 },
        requirements: [{ type: "unitWithTag", tag: "Miner" }],
        inputs: [{ type: "unit", multiple: true, tag: "Miner" }, { type: "text", label: "Deposit" }],
        check: { abilities: ["str", "con"], tableId: "extract" },
      },
      {
        id: "extract-monster",
        name: "Extract Monster",
        description: "Harvest resources from a dead monster with a Dexterity or Wisdom check. One free use per unit each round.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1 },
        inputs: [{ type: "unit", multiple: true }, { type: "text", label: "Corpse" }],
        check: { abilities: ["dex", "wis"], tableId: "extract" },
      },
      {
        id: "heal-unit",
        name: "Heal Unit",
        description:
          "Heal a unit in a region you control: 1 Gold per 5 HP (rounded up, minimum 1) or 1 Food per 10 HP, mixed as you like. A Healer heals one unit to full for free, anywhere.",
        kind: "numbered",
        handler: "heal",
        config: { rates: [{ resourceId: "gold", hpPer: 5 }, { resourceId: "food", hpPer: 10 }], minimumCost: 1, freeWithTag: "Healer" },
        inputs: [{ type: "unit" }, { type: "number", label: "Heal to HP", min: 1 }],
      },
      {
        id: "improvise",
        name: "Improvise",
        description: "Describe anything not covered by another action. You can commit resources to improve the odds.",
        kind: "numbered",
        handler: "manual",
        inputs: [{ type: "text", label: "What do you do?" }, { type: "resources", label: "Resources committed" }],
      },
      {
        id: "move",
        name: "Move Unit",
        description: "Move a unit up to its movement. Entering a region with enemies starts combat unless you say you retreat or act peacefully.",
        kind: "numbered",
        handler: "move",
        config: { mode: "normal" },
        requirements: [{ type: "unitHasMovement" }],
        inputs: [{ type: "unit" }, { type: "path" }],
      },
      {
        id: "move-stealth",
        name: "Move Unit – Stealth",
        description:
          "Move at half speed, making a Stealth check in each region. On a success the unit avoids combat. Only Scouts and Assassins can be picked up.",
        kind: "numbered",
        handler: "move",
        config: { mode: "stealth" },
        requirements: [{ type: "unitWithTag", tag: "Stealthy" }, { type: "unitHasMovement" }],
        inputs: [{ type: "unit", tag: "Stealthy" }, { type: "path" }],
      },
      {
        id: "move-force-march",
        name: "Move Unit – Force March",
        description: "Move up to twice the unit's movement, with disadvantage on attacks, checks and saves for the rest of the round.",
        kind: "numbered",
        handler: "move",
        config: { mode: "forceMarch" },
        requirements: [{ type: "unitHasMovement" }],
        inputs: [{ type: "unit" }, { type: "path" }],
      },
      {
        id: "raid",
        name: "Raid",
        description: "A unit in (or passing through) another faction's region steals Gold and Food equal to half what the region produces. Nothing is gained if the unit dies there.",
        kind: "numbered",
        handler: "raid",
        config: { fraction: 0.5 },
        inputs: [{ type: "unit" }, { type: "region" }],
      },
      {
        id: "reanimate",
        name: "Reanimate",
        description: "Raise a dead humanoid in this region as a Zombie, or spend Pristine Bones to raise a Skeleton. Zombies and Skeletons need no upkeep.",
        kind: "numbered",
        handler: "reanimate",
        config: { corpseCreatureId: "zombie", itemCreature: { itemId: "pristine-bones", creatureId: "skeleton" } },
        requirements: [{ type: "unitWithTag", tag: "Necromancer" }],
        inputs: [{ type: "unit", tag: "Necromancer" }, { type: "choice", label: "Raise", options: ["Zombie from a corpse", "Skeleton from Pristine Bones"] }],
      },
      {
        id: "recruit",
        name: "Recruit Unit",
        description: "Pay for and recruit a unit in a region you control with a settlement.",
        kind: "numbered",
        handler: "recruit",
        requirements: [{ type: "regionOwner", owner: "self" }, { type: "settlementPresent" }],
        inputs: [{ type: "region" }, { type: "creature" }, { type: "race" }],
      },
      {
        id: "search",
        name: "Search",
        description: "Search a region for resources, hidden units, or a structure such as a Ruin or Dungeon, using Wisdom, Intelligence or Charisma.",
        kind: "numbered",
        handler: "rollCheck",
        inputs: [{ type: "unit", multiple: true }, { type: "choice", label: "Search for", options: ["Resources", "Hidden units", "Ruin or Dungeon"] }],
        check: { abilities: ["wis", "int", "cha"], tableId: "search" },
      },
      {
        id: "spy",
        name: "Spy",
        description: "A stealthed unit learns about the region it's in, using its best of Wisdom, Intelligence or Charisma. One free use per Scout or Assassin.",
        kind: "numberedAndFree",
        limit: { times: 1, per: "unit" },
        handler: "rollCheck",
        config: { extraNumberedUses: 1 },
        requirements: [{ type: "unitWithTag", tag: "Stealthy" }, { type: "unitStealthed" }],
        inputs: [{ type: "unit", tag: "Stealthy" }],
        check: { abilities: ["wis", "int", "cha"], tableId: "spy" },
      },
      {
        id: "teleport",
        name: "Teleport",
        description:
          "The Archmage teleports to a region you own: 50% on target, 25% one region off, 15% two regions off, 10% a random region. (The later, more detailed of the two rules versions.)",
        kind: "numbered",
        handler: "teleport",
        config: {
          outcomes: [
            { weight: 50, regionsOff: 0 },
            { weight: 25, regionsOff: 1 },
            { weight: 15, regionsOff: 2 },
            { weight: 10, random: true },
          ],
        },
        requirements: [{ type: "unitOfCreature", creatureId: "archmage" }],
        inputs: [{ type: "unit" }, { type: "region" }],
      },
      {
        id: "upgrade-building",
        name: "Upgrade Building",
        description: "Pay for and upgrade a building to its next tier.",
        kind: "numbered",
        handler: "upgradeBuilding",
        requirements: [{ type: "regionOwner", owner: "self" }],
        inputs: [{ type: "region" }, { type: "building" }],
      },
      {
        id: "use-portal",
        name: "Use Portal",
        description: "Send units through a portal to a connected portal, your own Portal building elsewhere, or a portal you've been given access to.",
        kind: "numbered",
        handler: "portal",
        requirements: [{ type: "buildingInRegion", buildingId: "portal" }],
        inputs: [{ type: "unit", multiple: true }, { type: "region", label: "Destination" }],
      },
      // Free actions
      { id: "apply-augment", name: "Apply Augment", description: "Equip an augment from your inventory on a unit.", kind: "free", handler: "applyAugment", inputs: [{ type: "unit" }, { type: "item" }] },
      {
        id: "capture-monster",
        name: "Capture Monster",
        description:
          "Use when entering combat with a known monster. Once it's below a quarter HP and alone, your units try to capture it instead of attacking. A captured monster must be taken to another region, a Breeding Pit or a Menagerie by the end of next round.",
        kind: "free",
        limit: { times: 1, per: "unit" },
        handler: "capture",
        inputs: [{ type: "unit", multiple: true }, { type: "text", label: "Monster" }],
      },
      {
        id: "craft-research",
        name: "Craft / Research",
        description: "Craft an item from a known recipe, or research an item to learn 1d4 recipes it can be crafted into. Uses come from Smithies.",
        kind: "free",
        handler: "craft",
        config: { researchDice: "1d4" },
        inputs: [{ type: "choice", label: "Craft or research", options: ["Craft", "Research"] }, { type: "recipe" }, { type: "item" }],
      },
      { id: "disband", name: "Disband Unit", description: "Disband a unit in a region you control. Its augments return to your inventory.", kind: "free", handler: "disband", requirements: [{ type: "regionOwner", owner: "self" }], inputs: [{ type: "unit" }] },
      {
        id: "divine-intervention",
        name: "Divine Intervention",
        description: "Describe the help you seek and from which god. Uses come from Temples.",
        kind: "free",
        handler: "rollCheck",
        inputs: [{ type: "text", label: "Your prayer" }],
        check: { abilities: ["wis"], tableId: "divine-intervention" },
      },
      { id: "store-beast", name: "Store Beast", description: "Store your tamed beast in a Menagerie in this region.", kind: "free", limit: { times: 1, per: "unit" }, handler: "storeBeast", requirements: [{ type: "unitWithTag", tag: "Beastmaster" }, { type: "buildingInRegion", buildingId: "menagerie" }], inputs: [{ type: "unit", tag: "Beastmaster" }] },
      { id: "swap-retrieve-beast", name: "Swap / Retrieve Beast", description: "Swap your tamed beast with one stored in a Menagerie here, or retrieve one.", kind: "free", limit: { times: 1, per: "unit" }, handler: "retrieveBeast", requirements: [{ type: "unitWithTag", tag: "Beastmaster" }, { type: "buildingInRegion", buildingId: "menagerie" }], inputs: [{ type: "unit", tag: "Beastmaster" }, { type: "text", label: "Beast" }] },
      {
        id: "tame-beast",
        name: "Tame Beast",
        description: "When the Beastmaster enters a region with a monster, it tries to tame it before combat. On a success it must stay there the rest of the round; on a failure the beast may flee, or attack on a bad failure.",
        kind: "free",
        limit: { times: 1, per: "unit" },
        handler: "tame",
        requirements: [{ type: "unitWithTag", tag: "Beastmaster" }],
        inputs: [{ type: "unit", tag: "Beastmaster" }, { type: "text", label: "Monster" }],
      },
      { id: "trade", name: "Trade", description: "Trade resources, items, recipes, map information, units or regions with a team you've met.", kind: "free", handler: "trade", inputs: [{ type: "team" }, { type: "text", label: "Offer and request" }] },
      { id: "use-market", name: "Use Market", description: "Exchange 4 Gold for 1 Food, or 1 Food for 2 Gold. Requires a Market.", kind: "free", handler: "market", requirements: [{ type: "text", text: "You own a Market" }], inputs: [{ type: "resources", label: "Exchange" }] },
      { id: "use-resource", name: "Use Resource", description: "Use an item outside combat, or convert items into materials or income.", kind: "free", handler: "useItem", inputs: [{ type: "item" }, { type: "text", label: "How" }] },
    ],

    rollTables: [
      {
        id: "excavate",
        name: "Excavate",
        category: "check",
        modifierNote: "+ the miner's STR or CON modifier, whichever is higher, + item bonuses",
        bands: [
          band(1, 7, `Cave-in! The miner takes damage. (${P})`, [{ type: "damageActor", dice: "1d6" }]),
          band(8, 10, `Nothing but rock. (${P})`),
          band(11, 15, `You find a basic material. (${P})`, [{ type: "rollTable", tableId: "loot-common" }]),
          band(16, 18, `The tunnel breaks into a passage. (${P})`, [{ type: "revealConnection" }]),
          band(19, null, `You break through into a new region! (${P})`, [{ type: "revealRegion" }, { type: "rollTable", tableId: "new-region" }]),
        ],
      },
      {
        id: "extract",
        name: "Extract",
        category: "check",
        modifierNote: "+ the relevant ability modifier",
        bands: [
          band(1, 7, `The attempt fails and the material is damaged. (${P})`),
          band(8, 12, `You extract a little. (${P})`, [{ type: "rollTable", tableId: "loot-common" }]),
          band(13, null, `A good haul. (${P})`, [{ type: "rollTable", tableId: "loot-common", times: 2 }]),
        ],
      },
      {
        id: "new-region",
        name: "New Region",
        category: "other",
        die: "1d6",
        bands: [
          band(1, 2, `An empty cavern. (${P})`),
          band(3, 4, `A cavern with a deposit. (${P})`, [{ type: "addDeposit" }]),
          band(5, 5, `Ancient ruins. (${P})`, [{ type: "findStructure", kind: "ruin" }]),
          band(6, 6, `Something lives here… (${P})`, [{ type: "spawnMonster", creatureId: null }]),
        ],
      },
      {
        id: "hunters-post",
        name: "Hunter's Post",
        category: "building",
        modifierNote: "+1 per Hunter Post tier",
        buildingBonus: { buildingId: "hunter-post", perTier: 1 },
        bands: [
          band(1, 10, `The hunters return with nothing extra. (${P})`),
          band(11, 17, `Extra game. (${P})`, [{ type: "gainResource", resourceId: "food", amount: "1" }]),
          band(18, null, `The hunters bring back a material. (${P})`, [{ type: "rollTable", tableId: "loot-common" }]),
        ],
      },
      {
        id: "divine-intervention",
        name: "Divine Intervention",
        category: "check",
        die: "1d100",
        modifierNote: "War Priests roll with advantage",
        bands: [
          band(1, 70, `Your prayers go unanswered. (${P})`),
          band(71, 95, `Guidance: the DM gives a vision or hint. (${P})`),
          band(96, null, `A direct boon from your god. (${P})`),
        ],
      },
      {
        id: "race",
        name: "Race",
        category: "other",
        die: "1d8",
        bands: [
          band(1, 1, "Human"),
          band(2, 2, "Dwarf"),
          band(3, 3, "Elf"),
          band(4, 4, "Drow"),
          band(5, 5, "Duergar"),
          band(6, 6, "Deep Gnome"),
          band(7, 7, "Orc"),
          band(8, 8, `Halfling (${P})`),
        ],
      },
      {
        id: "loot-common",
        name: "Loot (common material)",
        category: "loot",
        die: "1d10",
        bands: [
          band(1, 4, "Metal", [{ type: "gainItem", itemId: "metal", qty: "1" }]),
          band(5, 8, "Wood", [{ type: "gainItem", itemId: "wood", qty: "1" }]),
          band(9, 10, `Gemstone (${P})`, [{ type: "gainItem", itemId: "gemstone", qty: "1" }]),
        ],
      },
      {
        id: "encounter",
        name: "Encounter",
        category: "encounter",
        die: "1d6",
        bands: [
          band(1, 2, "Giant Lizard", [{ type: "spawnMonster", creatureId: "giant-lizard" }]),
          band(3, 4, "Giant Spider", [{ type: "spawnMonster", creatureId: "giant-spider" }]),
          band(5, 5, "Ghoul", [{ type: "spawnMonster", creatureId: "ghoul" }]),
          band(6, 6, `Drider (${P})`, [{ type: "spawnMonster", creatureId: "drider" }]),
        ],
      },
      {
        id: "dungeon",
        name: "Dungeon",
        category: "check",
        bands: [
          band(1, 7, `A trap springs. (${P})`, [{ type: "damageActor", dice: "2d6" }]),
          band(8, 14, `Guardians attack! (${P})`, [{ type: "rollTable", tableId: "encounter" }]),
          band(15, null, `Treasure. (${P})`, [{ type: "rollTable", tableId: "loot-common", times: 2 }]),
        ],
      },
      {
        id: "search",
        name: "Search",
        category: "check",
        modifierNote: "+ the best Wisdom, Intelligence or Charisma modifier among the searching units",
        bands: [
          band(1, 9, `You find nothing. (${P})`),
          band(10, 14, `You find something minor. (${P})`, [{ type: "rollTable", tableId: "loot-common" }]),
          band(15, null, `You find a deposit or a hidden structure. (${P})`, [{ type: "addDeposit" }]),
        ],
      },
      {
        id: "spy",
        name: "Spy",
        category: "check",
        bands: [
          band(1, 9, `You learn little, and may have been noticed. (${P})`),
          band(10, 14, `You learn the units and buildings in the region. (${P})`),
          band(15, null, `You learn their plans for next round. (${P})`),
        ],
      },
      {
        id: "tavern",
        name: "Tavern",
        category: "building",
        bands: [band(1, 10, `Only idle gossip. (${P})`), band(11, null, `A useful rumour about a nearby region. (${P})`)],
      },
      {
        id: "turn-event",
        name: "Turn Event",
        category: "event",
        bands: [band(1, 5, `Trouble strikes. (${P})`), band(6, 15, `A quiet round. (${P})`), band(16, null, `Good fortune. (${P})`)],
      },
      {
        id: "economy-deficit",
        name: "Economy Deficit",
        category: "deficit",
        bands: [
          band(1, 5, `Unrest: a unit disbands. (${P})`),
          band(6, 12, `Your people grumble. Some actions may not resolve. (${P})`),
          band(13, null, `You scrape by this time. (${P})`),
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
        id: "economy",
        title: "Economy",
        body: "Gold is your currency and your ability to motivate your people. Food feeds your workers and units. Growth is your ability to expand: surplus supplies, building materials and population. If you end a round with a negative resource, some of the actions that caused it may not resolve, random events may punish your reckless spending, units may disband and your people may revolt.",
      },
    ],
  };
  return Ruleset.parse(input);
}
