"use client";

import { ABILITIES, ABILITY_NAMES } from "@/engine/ruleset/common";
import { ACTION_HANDLERS, CREATURE_CATEGORIES, type RulesetSection } from "@/engine/ruleset/ruleset";
import { rangeField, type FieldSpec, type Variant } from "./fields";

/* eslint-disable @typescript-eslint/no-explicit-any */

// What each ruleset editor tab shows. Creatures have their own richer editor.

export interface SectionConfig {
  title: string;
  /** One line under the title. */
  intro: string;
  fields: FieldSpec[];
  newItem: (id: string) => Record<string, any>;
  label: (item: any) => string;
}

const idField: FieldSpec = {
  kind: "text",
  key: "id",
  label: "ID",
  help: "short, lower-case, used by other rules to refer to this; renaming it breaks those references",
};
const nameField: FieldSpec = { kind: "text", key: "name", label: "Name" };
const descriptionField: FieldSpec = { kind: "textarea", key: "description", label: "Description", rows: 2 };
const opt = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

export const abilityBonusesField = (key: string, label: string): FieldSpec => ({
  kind: "custom",
  key,
  label,
  render: (value: Record<string, number> | undefined, onChange) => (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {ABILITIES.map((a) => (
        <label key={a} className="flex flex-col text-xs">
          <span className="mb-0.5 text-muted" title={ABILITY_NAMES[a]}>
            {a.toUpperCase()}
          </span>
          <input
            type="number"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={value?.[a] ?? ""}
            placeholder="0"
            onChange={(e) => {
              const next = { ...(value ?? {}) };
              if (e.target.value === "" || Number(e.target.value) === 0) delete next[a];
              else next[a] = Number(e.target.value);
              onChange(next);
            }}
          />
        </label>
      ))}
    </div>
  ),
});

const requirementVariants: Record<string, Variant> = {
  unitWithTag: {
    label: "A unit with a tag is involved",
    fields: [{ kind: "text", key: "tag", label: "Tag" }],
    template: () => ({ type: "unitWithTag", tag: "" }),
  },
  unitOfCreature: {
    label: "A unit of a specific type is involved",
    fields: [{ kind: "select", key: "creatureId", label: "Unit type", options: { ref: "creatures" } }],
    template: () => ({ type: "unitOfCreature", creatureId: "" }),
  },
  buildingInRegion: {
    label: "A building is in the region",
    fields: [
      { kind: "select", key: "buildingId", label: "Building", options: { ref: "buildings" } },
      { kind: "number", key: "minTier", label: "Minimum tier", min: 1 },
    ],
    template: () => ({ type: "buildingInRegion", buildingId: "", minTier: 1 }),
  },
  regionOwner: {
    label: "Region ownership",
    fields: [
      {
        kind: "select",
        key: "owner",
        label: "Region must be",
        options: [
          { value: "self", label: "owned by the team" },
          { value: "unowned", label: "unowned" },
          { value: "other", label: "owned by another team" },
        ],
      },
    ],
    template: () => ({ type: "regionOwner", owner: "self" }),
  },
  noHostileUnits: { label: "No hostile units in the region", fields: [], template: () => ({ type: "noHostileUnits" }) },
  ownUnitInRegion: { label: "One of the team's units is in the region", fields: [], template: () => ({ type: "ownUnitInRegion" }) },
  unitHasMovement: { label: "The unit has movement left", fields: [], template: () => ({ type: "unitHasMovement" }) },
  unitStealthed: { label: "The unit is stealthed", fields: [], template: () => ({ type: "unitStealthed" }) },
  settlementPresent: {
    label: "A settlement is in the region",
    fields: [{ kind: "select", key: "minTierId", label: "At least", options: { ref: "settlementTiers" }, nullable: true, nullLabel: "any tier" }],
    template: () => ({ type: "settlementPresent" }),
  },
  freeSlot: { label: "A free building slot", fields: [], template: () => ({ type: "freeSlot" }) },
  itemInInventory: {
    label: "An item in the inventory",
    fields: [{ kind: "select", key: "itemId", label: "Item", options: { ref: "items" }, nullable: true, nullLabel: "any item" }],
    template: () => ({ type: "itemInInventory" }),
  },
  text: { label: "Text only (DM checks)", fields: [{ kind: "text", key: "text", label: "Requirement" }], template: () => ({ type: "text", text: "" }) },
};

const labelOnly = (type: string, label: string, extra: FieldSpec[] = [], template: Record<string, any> = {}): Variant => ({
  label,
  fields: [{ kind: "text", key: "label", label: "Label shown to players" }, ...extra],
  template: () => ({ type, label, ...template }),
});

const inputVariants: Record<string, Variant> = {
  unit: labelOnly("unit", "Unit picker", [
    { kind: "checkbox", key: "multiple", label: "Pick several" },
    { kind: "text", key: "tag", label: "Only units with tag" },
  ]),
  region: labelOnly("region", "Region picker"),
  path: labelOnly("path", "Path on the map"),
  creature: labelOnly("creature", "Unit type"),
  race: labelOnly("race", "Race"),
  archetype: labelOnly("archetype", "Archetype"),
  spell: labelOnly("spell", "Spell"),
  building: labelOnly("building", "Building type"),
  settlementTier: labelOnly("settlementTier", "Settlement tier"),
  item: labelOnly("item", "Item"),
  recipe: labelOnly("recipe", "Recipe"),
  team: labelOnly("team", "Team"),
  resources: labelOnly("resources", "Resource amounts"),
  ability: labelOnly("ability", "Ability score"),
  number: labelOnly("number", "Number", [{ kind: "number", key: "min", label: "Minimum", nullable: true }], { label: "Amount" }),
  choice: labelOnly("choice", "Multiple choice", [{ kind: "tags", key: "options", label: "Options" }], { options: ["A", "B"] }),
  text: labelOnly("text", "Free text", [], { label: "Details" }),
};

const resultVariants: Record<string, Variant> = {
  gainResource: {
    label: "Gain a resource",
    fields: [
      { kind: "select", key: "resourceId", label: "Resource", options: { ref: "resources" } },
      { kind: "text", key: "amount", label: "Amount (number or dice)", placeholder: "1d4" },
    ],
    template: () => ({ type: "gainResource", resourceId: "", amount: "1" }),
  },
  gainItem: {
    label: "Gain an item",
    fields: [
      { kind: "select", key: "itemId", label: "Item", options: { ref: "items" } },
      { kind: "text", key: "qty", label: "Quantity (number or dice)" },
    ],
    template: () => ({ type: "gainItem", itemId: "", qty: "1" }),
  },
  rollTable: {
    label: "Roll on another table",
    fields: [
      { kind: "select", key: "tableId", label: "Table", options: { ref: "rollTables" } },
      { kind: "number", key: "times", label: "Times", min: 1 },
      { kind: "custom", key: "ignore", label: "Re-roll these results", render: (v: number[] | undefined, onChange) => (
        <input
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          placeholder="e.g. 10"
          defaultValue={(v ?? []).join(", ")}
          onChange={(e) => onChange(e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n !== 0))}
        />
      ) },
    ],
    template: () => ({ type: "rollTable", tableId: "", times: 1, ignore: [] }),
  },
  damageActor: {
    label: "Damage the acting unit",
    fields: [{ kind: "text", key: "dice", label: "Dice", placeholder: "1d6" }],
    template: () => ({ type: "damageActor", dice: "1d6" }),
  },
  spawnMonster: {
    label: "Spawn a monster",
    fields: [{ kind: "select", key: "creatureId", label: "Monster", options: { ref: "creatures" }, nullable: true, nullLabel: "DM picks" }],
    template: () => ({ type: "spawnMonster", creatureId: null }),
  },
  revealConnection: { label: "Reveal a connection", fields: [], template: () => ({ type: "revealConnection" }) },
  revealRegion: { label: "Reveal or create a region", fields: [], template: () => ({ type: "revealRegion" }) },
  addDeposit: { label: "Add a deposit", fields: [{ kind: "text", key: "note", label: "Note" }], template: () => ({ type: "addDeposit", note: "" }) },
  findStructure: {
    label: "Find a ruin or dungeon",
    fields: [{ kind: "select", key: "kind", label: "Kind", options: opt(["ruin", "dungeon"]) }],
    template: () => ({ type: "findStructure", kind: "ruin" }),
  },
  learnRecipes: {
    label: "Learn recipes",
    fields: [{ kind: "text", key: "count", label: "How many (number or dice)" }],
    template: () => ({ type: "learnRecipes", count: "1d4" }),
  },
  moveActor: {
    label: "Move the acting unit",
    fields: [
      { kind: "number", key: "regions", label: "Regions away", min: 0 },
      { kind: "checkbox", key: "random", label: "To a random region instead" },
    ],
    template: () => ({ type: "moveActor", regions: 1, random: false }),
  },
};

export const SECTION_CONFIG: Record<Exclude<RulesetSection, "creatures">, SectionConfig> = {
  resources: {
    title: "Resources",
    intro: "Anything teams collect and spend, e.g. Gold, Food, Growth.",
    fields: [
      idField,
      nameField,
      { kind: "text", key: "icon", label: "Icon (an emoji)" },
      { kind: "colour", key: "colour", label: "Colour" },
      {
        kind: "select",
        key: "kind",
        label: "Kind",
        options: [
          { value: "stockpile", label: "Stockpile (can be spent)" },
          { value: "accumulating", label: "Accumulating (only counts up)" },
        ],
      },
      { kind: "number", key: "startingAmount", label: "Starting amount" },
    ],
    newItem: (id) => ({ id, name: "New resource", icon: "", colour: "#888888", kind: "stockpile", startingAmount: 0 }),
    label: (x) => `${x.icon ?? ""} ${x.name}`.trim(),
  },
  terrainTypes: {
    title: "Terrain",
    intro: "Terrain areas drawn on the map (and links between regions) have a terrain that changes how far units get. The part of a move inside an area follows its rules.",
    fields: [
      idField,
      nameField,
      { kind: "number", key: "costMultiplier", label: "Distance multiplier", help: "difficult terrain = 2", step: 0.5 },
      { kind: "colour", key: "colour", label: "Colour on the map", help: "leave the box empty for an automatic colour" },
      { kind: "checkbox", key: "bypassedByFlying", label: "Flying units ignore the multiplier" },
      { kind: "checkbox", key: "bypassedByNaturalExplorer", label: "Groups with a Natural Explorer ignore it" },
      { kind: "multiselect", key: "requiresMovement", label: "Needs one of these speeds to cross", options: opt(["fly", "swim", "climb", "burrow"]) },
    ],
    newItem: (id) => ({ id, name: "New terrain", costMultiplier: 1, bypassedByFlying: false, bypassedByNaturalExplorer: false, requiresMovement: [], colour: "" }),
    label: (x) => x.name,
  },
  settlementTiers: {
    title: "Settlements",
    intro: "Settlement tiers in upgrade order, e.g. Outpost → Settlement → City → Capital.",
    fields: [
      idField,
      nameField,
      descriptionField,
      { kind: "select", key: "upgradesFrom", label: "Upgrades from", options: { ref: "settlementTiers" }, nullable: true, nullLabel: "— built on an empty region —" },
      { kind: "number", key: "buildingSlots", label: "Building slots", min: 0 },
      { kind: "resources", key: "cost", label: "Cost" },
      {
        kind: "list",
        key: "discounts",
        label: "Discounts",
        newItem: () => ({ when: "ruinPresent", amount: {} }),
        itemLabel: () => "When a Ruin is present",
        fields: [
          { kind: "select", key: "when", label: "When", options: [{ value: "ruinPresent", label: "A Ruin is present" }] },
          { kind: "resources", key: "amount", label: "Costs less by" },
        ],
      },
      { kind: "resources", key: "production", label: "Production each round" },
      { kind: "resources", key: "upkeep", label: "Upkeep each round" },
      { kind: "number", key: "maxPerTeam", label: "Max per team", nullable: true },
      { kind: "number", key: "heroLimit", label: "Heroes per settlement", nullable: true },
      {
        kind: "list",
        key: "ratio",
        label: "For each one of these, the team needs…",
        itemLabel: (r) => `${r.count} × ${r.tierId}`,
        newItem: () => ({ tierId: "", count: 1 }),
        fields: [
          { kind: "number", key: "count", label: "How many", min: 1 },
          { kind: "select", key: "tierId", label: "Other settlements of tier", options: { ref: "settlementTiers" } },
        ],
      },
      { kind: "multiselect", key: "recruitCategories", label: "Can recruit", options: opt(CREATURE_CATEGORIES) },
      { kind: "checkbox", key: "requiresUnclaimed", label: "Region must be unclaimed" },
      { kind: "checkbox", key: "requiresNoHostiles", label: "No hostile units allowed" },
      { kind: "effects", key: "effects", label: "Effects" },
    ],
    newItem: (id) => ({ id, name: "New tier", description: "", upgradesFrom: null, cost: {}, discounts: [], ratio: [], buildingSlots: 1, production: {}, upkeep: {}, maxPerTeam: null, recruitCategories: ["standard"], heroLimit: null, requiresUnclaimed: false, requiresNoHostiles: false, effects: [] }),
    label: (x) => x.name,
  },
  buildings: {
    title: "Buildings",
    intro: "Buildings with upgrade tiers. A higher tier can only be reached by upgrading.",
    fields: [
      idField,
      nameField,
      descriptionField,
      {
        kind: "select",
        key: "buildChoice",
        label: "Choice when built",
        options: [
          { value: "none", label: "None" },
          { value: "ability", label: "An ability score (e.g. Academy)" },
        ],
      },
      { kind: "number", key: "maxPerRegion", label: "Max per region", nullable: true },
      {
        kind: "list",
        key: "tiers",
        label: "Tiers",
        itemLabel: (_t, i) => `Tier ${i + 1}`,
        newItem: () => ({ description: "", cost: {}, upkeep: {}, production: {}, effects: [] }),
        fields: [
          { kind: "textarea", key: "description", label: "What this tier does", rows: 2 },
          { kind: "resources", key: "cost", label: "Cost" },
          { kind: "resources", key: "upkeep", label: "Upkeep each round" },
          { kind: "resources", key: "production", label: "Production each round" },
          { kind: "effects", key: "effects", label: "Effects" },
        ],
      },
    ],
    newItem: (id) => ({ id, name: "New building", description: "", buildChoice: "none", maxPerRegion: 1, tiers: [{ description: "", cost: {}, upkeep: {}, production: {}, effects: [] }] }),
    label: (x) => `${x.name}${x.tiers?.length > 1 ? ` (${x.tiers.length} tiers)` : ""}`,
  },
  races: {
    title: "Races",
    intro: "Peoples a unit can belong to. Bonuses are added on top of the unit's stat block.",
    fields: [idField, nameField, descriptionField, abilityBonusesField("abilityBonuses", "Ability score bonuses"), { kind: "effects", key: "effects", label: "Other effects" }],
    newItem: (id) => ({ id, name: "New race", description: "", abilityBonuses: {}, effects: [] }),
    label: (x) => x.name,
  },
  archetypes: {
    title: "Archetypes",
    intro: "Roles a player picks for a unit when recruiting it (Scout, Regiment, Defender…). They add tags, abilities and actions on top of the stat block.",
    fields: [
      idField,
      nameField,
      descriptionField,
      { kind: "multiselect", key: "categories", label: "Available to", options: opt(CREATURE_CATEGORIES) },
      { kind: "tags", key: "tags", label: "Tags the unit gains", placeholder: "e.g. Stealthy, Miner" },
      { kind: "number", key: "visionRange", label: "Vision (regions away; empty = the creature's own)", nullable: true },
      { kind: "select", key: "recruitRequiresBuildingId", label: "Recruit only where there's a", options: { ref: "buildings" }, nullable: true, nullLabel: "— anywhere —" },
      { kind: "multiselect", key: "unlocksActions", label: "Unlocks actions", options: { ref: "actionTypes" } },
      { kind: "resources", key: "extraCost", label: "Extra recruit cost" },
      { kind: "resources", key: "extraUpkeep", label: "Extra upkeep" },
      { kind: "effects", key: "effects", label: "Abilities" },
    ],
    newItem: (id) => ({ id, name: "New archetype", description: "", categories: ["standard"], tags: [], effects: [], unlocksActions: [], visionRange: null, recruitRequiresBuildingId: null, extraCost: {}, extraUpkeep: {} }),
    label: (x) => `${x.name}${x.categories?.includes("hero") && !x.categories?.includes("standard") ? " (hero)" : ""}`,
  },
  spells: {
    title: "Spells",
    intro: "Spells that archetypes and items can grant. Combat spells replace an attack; out-of-combat spells are cast with the Cast Spell action.",
    fields: [
      idField,
      nameField,
      { kind: "text", key: "tradition", label: "Tradition", placeholder: "Arcane, Divine, Primal" },
      { kind: "text", key: "restriction", label: "Who can learn it", placeholder: "Any Arcane" },
      { kind: "select", key: "when", label: "Cast", options: [{ value: "combat", label: "In combat (instead of attacking)" }, { value: "outOfCombat", label: "Out of combat (an action)" }] },
      {
        kind: "select",
        key: "review",
        label: "Automation",
        options: [
          { value: "auto", label: "Automated" },
          { value: "needsReview", label: "Automated, but check it" },
          { value: "text", label: "Text only (DM handles it)" },
        ],
      },
      { kind: "textarea", key: "description", label: "What it does", rows: 3 },
      { kind: "resources", key: "cost", label: "Cost to cast" },
      rangeField,
      rangeField,
    { kind: "json", key: "profile", label: "Combat profile (advanced)", rows: 8 },
    ],
    newItem: (id) => ({ id, name: "New spell", tradition: "Arcane", restriction: "", when: "combat", description: "", cost: {}, profile: { kind: "text" }, review: "text" }),
    label: (x) => `${x.name}${x.when === "outOfCombat" ? " (action)" : ""}`,
  },
  itemCategories: {
    title: "Item categories",
    intro: "Kinds of item, e.g. Basic Material, Material, Trinket, Augment. Items in an equippable category can be equipped on units from the unit's Edit window.",
    fields: [idField, nameField, { kind: "checkbox", key: "equippable", label: "Can be equipped on units" }],
    newItem: (id) => ({ id, name: "New category", equippable: false }),
    label: (x) => x.name,
  },
  equipSlots: {
    title: "Equipment slots",
    intro: "Where equipped items go on a unit, e.g. Armour, Shield, Weapon. An item without a slot only counts towards the total per unit, which is a game setting.",
    fields: [idField, nameField, { kind: "number", key: "maxPerUnit", label: "Max per unit", min: 1 }],
    newItem: (id) => ({ id, name: "New slot", maxPerUnit: 1 }),
    label: (x) => x.name,
  },
  items: {
    title: "Items",
    intro: "Materials, trinkets and equipment. An item is equippable if its category is; a slot is optional.",
    fields: [
      idField,
      nameField,
      { kind: "select", key: "categoryId", label: "Category", options: { ref: "itemCategories" } },
      { kind: "select", key: "slotId", label: "Equipment slot (equippable items)", options: { ref: "equipSlots" }, nullable: true, nullLabel: "— no slot —" },
      { kind: "text", key: "rarity", label: "Rarity" },
      { kind: "checkbox", key: "consumable", label: "Used up when used" },
      descriptionField,
      { kind: "tags", key: "tags", label: "Item tags", placeholder: "e.g. heat-resistant" },
      { kind: "tags", key: "requiresUnitTags", label: "Unit must have tags", placeholder: "e.g. Martial" },
      { kind: "multiselect", key: "requiresRaces", label: "Unit must be one of these races (none = any)", options: { ref: "races" } },
      { kind: "effects", key: "effects", label: "Effects" },
    ],
    newItem: (id) => ({ id, name: "New item", categoryId: "", description: "", rarity: "common", slotId: null, tags: [], requiresUnitTags: [], requiresRaces: [], effects: [], consumable: false }),
    label: (x) => x.name,
  },
  recipes: {
    title: "Recipes",
    intro: "What can be crafted from what.",
    fields: [
      idField,
      { kind: "checkbox", key: "knownAtStart", label: "Every team knows this at the start" },
      {
        kind: "list",
        key: "inputs",
        label: "Inputs",
        newItem: () => ({ itemId: "", qty: 1 }),
        fields: [
          { kind: "select", key: "itemId", label: "Item", options: { ref: "items" } },
          { kind: "number", key: "qty", label: "Quantity", min: 1 },
        ],
      },
      { kind: "resources", key: "resources", label: "Also costs" },
      {
        kind: "list",
        key: "outputs",
        label: "Makes",
        newItem: () => ({ itemId: "", qty: 1 }),
        fields: [
          { kind: "select", key: "itemId", label: "Item", options: { ref: "items" } },
          { kind: "number", key: "qty", label: "Quantity", min: 1 },
        ],
      },
    ],
    newItem: (id) => ({ id, inputs: [{ itemId: "", qty: 1 }], resources: {}, outputs: [{ itemId: "", qty: 1 }], knownAtStart: false }),
    label: (x) => x.id,
  },
  actionTypes: {
    title: "Actions",
    intro: "Everything teams can order. The handler decides what the app does automatically.",
    fields: [
      idField,
      nameField,
      { kind: "textarea", key: "description", label: "Description (shown to players)", rows: 3 },
      { kind: "text", key: "icon", label: "Icon (an emoji)" },
      {
        kind: "select",
        key: "kind",
        label: "Kind (moves are always free)",
        options: [
          { value: "numbered", label: "Numbered (uses an action slot)" },
          { value: "free", label: "Free" },
          { value: "conditional", label: "Conditional" },
          { value: "numberedAndFree", label: "Free, with extra uses as numbered actions" },
        ],
      },
      {
        kind: "select",
        key: "handler",
        label: "What the app does",
        options: ACTION_HANDLERS.map((h) => ({ value: h, label: h === "manual" ? "manual (DM resolves it)" : h })),
      },
      {
        kind: "object",
        key: "limit",
        label: "Limit",
        fields: [
          { kind: "number", key: "times", label: "Times (empty = no limit)", nullable: true },
          { kind: "select", key: "per", label: "Per", options: [{ value: "team", label: "team" }, { value: "unit", label: "unit" }, { value: "building", label: "building" }] },
          { kind: "select", key: "buildingId", label: "Building (when per building)", options: { ref: "buildings" }, nullable: true },
        ],
      },
      { kind: "resources", key: "cost", label: "Cost" },
      { kind: "unionList", key: "requirements", label: "Requirements", discriminator: "type", variants: requirementVariants, describe: (r) => requirementVariants[r.type]?.label + (r.tag ? `: ${r.tag}` : r.owner ? `: ${r.owner}` : r.buildingId ? `: ${r.buildingId}` : r.creatureId ? `: ${r.creatureId}` : r.text ? `: ${r.text}` : "") },
      { kind: "unionList", key: "inputs", label: "What the player fills in", discriminator: "type", variants: inputVariants, describe: (i) => `${inputVariants[i.type]?.label}: “${i.label}”` },
      {
        kind: "custom",
        key: "check",
        label: "Ability check (optional)",
        render: (v: { abilities: string[]; tableId: string } | null, onChange, ctx) => (
          <div className="space-y-2">
            {!v ? (
              <button type="button" className="rounded-md border border-border px-2 py-1 text-xs" onClick={() => onChange({ abilities: ["str"], tableId: ctx.ruleset.rollTables[0]?.id ?? "" })}>
                Add a check
              </button>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {ABILITIES.map((a) => (
                    <button
                      type="button"
                      key={a}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${v.abilities.includes(a) ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
                      onClick={() => onChange({ ...v, abilities: v.abilities.includes(a) ? v.abilities.filter((x) => x !== a) : [...v.abilities, a] })}
                    >
                      {a.toUpperCase()}
                    </button>
                  ))}
                  <span className="text-xs text-muted">(the best of these is used)</span>
                </div>
                <select className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={v.tableId} onChange={(e) => onChange({ ...v, tableId: e.target.value })} aria-label="Outcome table">
                  {ctx.ruleset.rollTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-danger" onClick={() => onChange(null)}>
                  Remove check
                </button>
              </>
            )}
          </div>
        ),
      },
      { kind: "json", key: "config", label: "Handler settings (advanced)", rows: 4 },
    ],
    newItem: (id) => ({ id, name: "New action", description: "", icon: "", kind: "numbered", limit: { times: null, per: "team" }, requirements: [], inputs: [{ type: "text", label: "Details" }], cost: {}, handler: "manual", config: {}, check: null }),
    label: (x) => `${x.name}${x.kind === "free" ? " (free)" : x.kind === "numberedAndFree" ? " (free/numbered)" : ""}`,
  },
  rollTables: {
    title: "Roll tables",
    intro: "Dice tables for checks, loot, encounters and events. Bands are looked up by the total.",
    fields: [
      idField,
      nameField,
      { kind: "select", key: "category", label: "Category", options: opt(["check", "loot", "encounter", "event", "deficit", "building", "other"]) },
      { kind: "text", key: "die", label: "Die", placeholder: "1d20" },
      { kind: "text", key: "modifierNote", label: "What's added to the roll (shown to the DM)", wide: true },
      {
        kind: "custom",
        key: "buildingBonus",
        label: "Bonus per building tier (optional)",
        render: (v: { buildingId: string; perTier: number } | null, onChange, ctx) =>
          !v ? (
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs" onClick={() => onChange({ buildingId: ctx.ruleset.buildings[0]?.id ?? "", perTier: 1 })}>
              Add a building bonus
            </button>
          ) : (
            <div className="flex gap-2">
              <select className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={v.buildingId} onChange={(e) => onChange({ ...v, buildingId: e.target.value })} aria-label="Building">
                {ctx.ruleset.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input type="number" className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={v.perTier} onChange={(e) => onChange({ ...v, perTier: Number(e.target.value) })} aria-label="Per tier" />
              <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-danger" onClick={() => onChange(null)}>
                ✕
              </button>
            </div>
          ),
      },
      {
        kind: "list",
        key: "bands",
        label: "Results",
        itemLabel: (b) => (b.max == null ? `${b.min}+` : b.min === b.max ? `${b.min}` : `${b.min}–${b.max}`),
        newItem: () => ({ min: 1, max: null, text: "", results: [] }),
        fields: [
          { kind: "number", key: "min", label: "From" },
          { kind: "number", key: "max", label: "To (empty = and above)", nullable: true },
          { kind: "textarea", key: "text", label: "Outcome text", rows: 2 },
          { kind: "unionList", key: "results", label: "What happens automatically", discriminator: "type", variants: resultVariants, describe: (r) => resultVariants[r.type]?.label ?? r.type },
        ],
      },
    ],
    newItem: (id) => ({ id, name: "New table", category: "other", die: "1d20", modifierNote: "", buildingBonus: null, bands: [{ min: 1, max: 10, text: "Failure", results: [] }, { min: 11, max: null, text: "Success", results: [] }] }),
    label: (x) => `${x.name} (${x.die})`,
  },
  rulesSections: {
    title: "Rules text",
    intro: "Free-text sections for the players' rules reference. Everything else there is generated from this ruleset.",
    fields: [idField, { kind: "text", key: "title", label: "Title" }, { kind: "textarea", key: "body", label: "Text", rows: 12 }],
    newItem: (id) => ({ id, title: "New section", body: "" }),
    label: (x) => x.title,
  },
};
