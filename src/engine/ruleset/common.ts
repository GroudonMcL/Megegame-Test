import { z } from "zod";

// Shared building blocks for the ruleset format. Every content definition has
// a short, human-readable `id` ("farm", "gold") that other definitions use to
// refer to it, so the JSON stays readable and hand-editable.

export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "IDs use lower-case letters, digits, - and _ (e.g. hunter-post)");

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const Ability = z.enum(ABILITIES);
export type Ability = z.infer<typeof Ability>;
export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;
export const DamageType = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof DamageType>;

export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
] as const;
export const Condition = z.enum(CONDITIONS);
export type Condition = z.infer<typeof Condition>;

/** Conditions that take a unit out of the fight; combat turns these into a damage penalty. */
export const DISABLING_CONDITIONS: readonly Condition[] = [
  "incapacitated",
  "stunned",
  "paralyzed",
  "unconscious",
  "petrified",
  "charmed",
];

export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export const Size = z.enum(SIZES);

/** An amount of each resource, e.g. { gold: 5, growth: 15 }. Missing keys mean 0. */
export const ResourceAmounts = z.record(Id, z.number());
export type ResourceAmounts = z.infer<typeof ResourceAmounts>;

/** A dice expression such as "1d8", "2d6+3" or "4" (see engine/dice.ts). */
export const DiceExpr = z.string().regex(/^[0-9dkhl+\- ]+$/i, 'Dice look like "1d8", "2d6+3" or "4"');

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** D&D proficiency bonus from Challenge Rating (CR below 1 counts as 1). */
export function proficiencyForCr(cr: number): number {
  return Math.floor((Math.max(cr, 1) - 1) / 4) + 2;
}

export function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
