import { z } from "zod";
import { Ability, DamageType, DiceExpr, Id, ResourceAmounts } from "./common";
import { StatAction, Uses } from "./statblock";

// The effects system: a fixed set of primitives that races, buildings, items,
// creature traits and region features use to change the game. Anything the
// primitives can't express is a "text" effect, which the app shows to the DM
// at the moment it matters.

/** A condition an effect needs. An effect with several needs all of them; none = always. */
export const EffectCondition = z.discriminatedUnion("when", [
  z.object({ when: z.literal("inOwnFortifiedRegion") }),
  z.object({ when: z.literal("inOwnedRegion") }),
  z.object({ when: z.literal("firstRound") }),
  z.object({ when: z.literal("surprising") }),
  z.object({ when: z.literal("alliesOutnumber") }),
  z.object({ when: z.literal("outnumbered") }),
  z.object({ when: z.literal("forceMarching") }),
  z.object({ when: z.literal("vsCreatureType"), creatureType: z.string().min(1) }),
  z.object({ when: z.literal("alliedWithTag"), tag: z.string().min(1) }),
  z.object({ when: z.literal("vsSpells") }),
]);
export type EffectCondition = z.infer<typeof EffectCondition>;
const EffectWhen = z.array(EffectCondition).default([]);

/**
 * What a modifier changes. "ability:str", "save:dex" and "check:<name>" take a
 * suffix; check names are action type IDs or "stealth", "search", "tame", "capture".
 */
export const StatTarget = z
  .string()
  .regex(
    /^(ac|toHit|damage|damageDice|attacks|saveDc|speed|perception|stealth|initiative|hp|ability:(str|dex|con|int|wis|cha)|save:(str|dex|con|int|wis|cha|all)|check:[a-z0-9_-]+)$/,
    'Use ac, toHit, damage, damageDice, attacks, saveDc, speed, perception, stealth, initiative, hp, ability:str, save:dex, save:all or check:<name>',
  );

const Per = z.enum(["round", "combat"]);

export const Effect = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("modifier"),
    target: StatTarget,
    value: z.number(),
    /** Extra dice, e.g. Hunter's Mark "1d6" on damage. */
    dice: DiceExpr.optional(),
    when: EffectWhen,
    /** Units with this tag get the bonus multiplied (e.g. Defender doubles fortifications). */
    tagMultiplier: z.object({ tag: z.string().min(1), factor: z.number() }).optional(),
  }),
  z.object({
    type: z.literal("advantage"),
    mode: z.enum(["advantage", "disadvantage"]),
    on: z
      .string()
      .regex(/^(attacks|attacksAgainst|saves|initiative|save:(str|dex|con|int|wis|cha)|check:[a-z0-9_-]+)$/),
    when: EffectWhen,
  }),
  z.object({
    type: z.literal("reduceDamage"),
    mode: z.enum(["flat", "halve"]),
    amount: z.number().int().min(0).default(0),
    times: z.number().int().positive(),
    per: Per,
  }),
  z.object({ type: z.literal("autoSucceedSave"), times: z.number().int().positive(), per: Per }),
  z.object({ type: z.literal("lifesteal"), fraction: z.number().positive().max(1) }),
  z.object({
    type: z.literal("raiseSlain"),
    creatureType: z.string().min(1),
    asCreatureId: Id,
    times: z.number().int().positive(),
    per: Per,
  }),
  z.object({ type: z.literal("grantAction"), action: StatAction }),
  z.object({ type: z.literal("vision"), range: z.number().int().min(0) }),
  z.object({
    type: z.literal("stealthDc"),
    dc: z.number().int(),
    enemyDisadvantage: z.boolean(),
    /** Stealthed units in adjacent regions must beat this DC too. */
    adjacentDc: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("regionDamage"),
    dice: DiceExpr,
    damageType: DamageType,
    trigger: z.enum(["roundStart", "enter"]),
    /** Units carrying an item with this tag are unaffected. */
    unlessItemTag: z.string().optional(),
  }),
  z.object({ type: z.literal("freeActions"), actionTypeId: Id, uses: z.number().int().positive() }),
  z.object({
    type: z.literal("exchange"),
    rates: z.array(z.object({ give: ResourceAmounts, get: ResourceAmounts })).min(1),
  }),
  z.object({ type: z.literal("storage"), capacity: z.number().int().positive(), tag: z.string().default("") }),
  z.object({ type: z.literal("rollEachRound"), tableId: Id }),
  z.object({ type: z.literal("abilityChoiceBonus"), amount: z.number().int() }),
  z.object({ type: z.literal("freeHeal"), units: z.number().int().positive() }),
  z.object({ type: z.literal("portal"), unitsPerAction: z.number().int().positive() }),
  z.object({ type: z.literal("ignoreDifficultTerrain"), group: z.boolean() }),
  /** Lets the unit cast these spells (from the ruleset's spell list). */
  z.object({ type: z.literal("spells"), spellIds: z.array(Id).min(1), uses: Uses.default({ type: "perCombat", times: 1 }) }),
  /** The unit doesn't pay this upkeep (e.g. a self-sufficient scout needs no Food). */
  z.object({ type: z.literal("waiveUpkeep"), resourceIds: z.array(Id).min(1) }),
  /** Changes how many augments this unit can carry. */
  z.object({ type: z.literal("augmentLimit"), max: z.number().int().min(0) }),
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
]);
export type Effect = z.infer<typeof Effect>;
export type EffectType = Effect["type"];

const ABILITY_LABEL: Record<z.infer<typeof Ability>, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

function targetLabel(target: string): string {
  const [head, tail] = target.split(":");
  switch (head) {
    case "ac":
      return "AC";
    case "toHit":
      return "to hit";
    case "damage":
      return "damage";
    case "damageDice":
      return "weapon damage dice";
    case "attacks":
      return "attacks per turn";
    case "saveDc":
      return "save DC";
    case "speed":
      return "speed (ft)";
    case "perception":
      return "passive Perception";
    case "stealth":
      return "Stealth";
    case "initiative":
      return "initiative";
    case "hp":
      return "max HP";
    case "ability":
      return ABILITY_LABEL[tail as keyof typeof ABILITY_LABEL] ?? tail;
    case "save":
      return tail === "all" ? "all saving throws" : `${ABILITY_LABEL[tail as keyof typeof ABILITY_LABEL] ?? tail} saves`;
    case "check":
      return `${tail} checks`;
    default:
      return target;
  }
}

function describeCondition(w: EffectCondition): string {
  switch (w.when) {
    case "inOwnFortifiedRegion":
      return "in a fortified region you control";
    case "inOwnedRegion":
      return "in a region you own";
    case "firstRound":
      return "in the first round of combat";
    case "surprising":
      return "when it surprises the enemy";
    case "alliesOutnumber":
      return "when allies outnumber enemies";
    case "outnumbered":
      return "when outnumbered";
    case "forceMarching":
      return "while force-marching";
    case "vsCreatureType":
      return `against ${w.creatureType} creatures`;
    case "alliedWithTag":
      return `while fighting alongside a ${w.tag} unit`;
    case "vsSpells":
      return "against spells";
  }
}

export function describeWhen(list: EffectCondition[]): string {
  return list.map(describeCondition).join(" and ");
}

function withWhen(text: string, list: EffectCondition[]) {
  const cond = describeWhen(list);
  return cond ? `${text} ${cond}` : text;
}

function per(p: "round" | "combat") {
  return p === "round" ? "per round" : "per combat";
}

/** Plain-English description used in the rules reference and unit screens. */
export interface EffectNames {
  action?: (id: string) => string;
  table?: (id: string) => string;
  creature?: (id: string) => string;
  spell?: (id: string) => string;
  resource?: (id: string) => string;
}

/** Name lookups for describeEffect, built from a ruleset. */
export function namesFrom(r: {
  actionTypes: { id: string; name: string }[];
  rollTables: { id: string; name: string }[];
  creatures: { id: string; statBlock: { name: string } }[];
  spells: { id: string; name: string }[];
  resources: { id: string; name: string }[];
}): EffectNames {
  const by = (list: { id: string; name: string }[]) => (id: string) => list.find((x) => x.id === id)?.name ?? id;
  return {
    action: by(r.actionTypes),
    table: by(r.rollTables),
    creature: (id) => r.creatures.find((c) => c.id === id)?.statBlock.name ?? id,
    spell: by(r.spells),
    resource: by(r.resources),
  };
}

export function describeEffect(e: Effect, names: EffectNames = {}): string {
  const action = names.action ?? ((id) => id);
  const table = names.table ?? ((id) => id);
  const creature = names.creature ?? ((id) => id);
  switch (e.type) {
    case "modifier": {
      const amount = [e.value !== 0 ? `${e.value > 0 ? "+" : ""}${e.value}` : "", e.dice ? `+${e.dice}` : ""]
        .filter(Boolean)
        .join(" ");
      const mult = e.tagMultiplier ? ` (×${e.tagMultiplier.factor} for ${e.tagMultiplier.tag} units)` : "";
      return withWhen(`${amount || "+0"} ${targetLabel(e.target)}${mult}`, e.when);
    }
    case "advantage": {
      const on = e.on === "attacksAgainst" ? "attacks against it" : e.on === "attacks" ? "attacks" : e.on === "saves" ? "saving throws" : targetLabel(e.on);
      return withWhen(`${e.mode === "advantage" ? "Advantage" : "Disadvantage"} on ${on}`, e.when);
    }
    case "reduceDamage":
      return e.mode === "halve"
        ? `Halve damage from one hit, ${e.times}× ${per(e.per)}`
        : `Reduce damage taken by ${e.amount}, ${e.times}× ${per(e.per)}`;
    case "autoSucceedSave":
      return `Turn a failed saving throw into a success, ${e.times}× ${per(e.per)}`;
    case "lifesteal":
      return `Regains HP equal to ${Math.round(e.fraction * 100)}% of damage it deals`;
    case "raiseSlain":
      return `Raises a slain ${e.creatureType} enemy as an allied ${creature(e.asCreatureId)}, ${e.times}× ${per(e.per)}`;
    case "grantAction":
      return `Grants the action “${e.action.name}”`;
    case "vision":
      return e.range === 0 ? "No extra vision" : `Grants vision ${e.range} region${e.range === 1 ? "" : "s"} away`;
    case "stealthDc":
      return [
        `Stealth DC ${e.dc} in this region`,
        e.enemyDisadvantage ? "enemies have disadvantage on Stealth" : "",
        e.adjacentDc ? `stealthed units in adjacent regions must beat DC ${e.adjacentDc}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    case "regionDamage":
      return `${e.dice} ${e.damageType} damage to units ${e.trigger === "enter" ? "entering the region" : "here at the start of each round"}${e.unlessItemTag ? ` unless they carry a ${e.unlessItemTag} item` : ""}`;
    case "freeActions":
      return `${e.uses}× free “${action(e.actionTypeId)}” per round`;
    case "exchange":
      return `Exchange: ${e.rates.map((r) => `${fmtRes(r.give)} → ${fmtRes(r.get)}`).join(", ")}`;
    case "storage":
      return `Stores up to ${e.capacity} ${e.tag ? `${e.tag} ` : ""}units`;
    case "rollEachRound":
      return `Rolls on “${table(e.tableId)}” each round`;
    case "abilityChoiceBonus":
      return `Units recruited here gain ${e.amount >= 0 ? "+" : ""}${e.amount} to an ability score chosen when built`;
    case "freeHeal":
      return `Heals ${e.units} unit${e.units === 1 ? "" : "s"} here to full HP each round`;
    case "portal":
      return `Transports ${e.unitsPerAction} unit${e.unitsPerAction === 1 ? "" : "s"} per Use Portal action`;
    case "ignoreDifficultTerrain":
      return e.group ? "It and units travelling with it ignore difficult terrain" : "Ignores difficult terrain";
    case "spells": {
      const uses = e.uses.type === "perCombat" ? ` (each ${e.uses.times}× per combat)` : e.uses.type === "perDay" ? ` (each ${e.uses.times}× per round)` : "";
      return `Can cast ${e.spellIds.map((id) => names.spell?.(id) ?? id).join(", ")}${uses}`;
    }
    case "waiveUpkeep":
      return `Pays no ${e.resourceIds.map((id) => names.resource?.(id) ?? id).join(" or ")} upkeep`;
    case "augmentLimit":
      return `Can equip up to ${e.max} augments`;
    case "text":
      return e.text;
  }
}

/** "10 Gold + 5 Food". Pass the ruleset's resources to use their names and order. */
export function fmtRes(r: Record<string, number>, resources?: { id: string; name: string }[]): string {
  const keys = resources
    ? [...resources.map((x) => x.id).filter((id) => id in r), ...Object.keys(r).filter((k) => !resources.some((x) => x.id === k))]
    : Object.keys(r);
  const parts = keys
    .filter((k) => r[k] !== 0)
    .map((k) => `${r[k]} ${resources?.find((x) => x.id === k)?.name ?? k}`);
  return parts.length ? parts.join(" + ") : "nothing";
}

/** Effects the engine can't apply automatically. */
export function isTextOnly(e: Effect): boolean {
  return e.type === "text";
}
