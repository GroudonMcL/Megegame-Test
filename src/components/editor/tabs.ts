import type { RulesetSection } from "@/engine/ruleset/ruleset";

export const RULESET_TABS: { slug: string; label: string; section?: RulesetSection }[] = [
  { slug: "settings", label: "Game settings" },
  { slug: "resources", label: "Resources", section: "resources" },
  { slug: "terrain", label: "Terrain", section: "terrainTypes" },
  { slug: "settlements", label: "Settlements", section: "settlementTiers" },
  { slug: "buildings", label: "Buildings", section: "buildings" },
  { slug: "races", label: "Races", section: "races" },
  { slug: "creatures", label: "Units & monsters", section: "creatures" },
  { slug: "item-categories", label: "Item categories", section: "itemCategories" },
  { slug: "augment-slots", label: "Augment slots", section: "augmentSlots" },
  { slug: "items", label: "Items", section: "items" },
  { slug: "recipes", label: "Recipes", section: "recipes" },
  { slug: "actions", label: "Actions", section: "actionTypes" },
  { slug: "tables", label: "Roll tables", section: "rollTables" },
  { slug: "rules", label: "Rules text", section: "rulesSections" },
  { slug: "json", label: "Import / export" },
];
