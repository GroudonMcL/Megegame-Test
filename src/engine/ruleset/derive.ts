import { ABILITIES, abilityMod, proficiencyForCr, type Ability, type ResourceAmounts } from "./common";
import type { Effect } from "./effects";
import type { Creature, Ruleset } from "./ruleset";
import { SKILL_ABILITY, type StatAction, type StatBlock } from "./statblock";

// Turns a base stat block plus layered bonuses (race, academy, augments) into
// the numbers the game uses, keeping a breakdown of where each number came from.

export interface Part {
  label: string;
  value: number;
}
export interface Breakdown {
  total: number;
  parts: Part[];
}

export interface Bonus {
  /** Shown in breakdowns, e.g. "Dwarf", "Academy", "Chain Shirt". */
  source: string;
  abilities?: Partial<Record<Ability, number>>;
  effects?: Effect[];
}

export interface EffectiveStats {
  abilities: Record<Ability, Breakdown>;
  mods: Record<Ability, number>;
  proficiency: number;
  ac: Breakdown;
  maxHp: Breakdown;
  speed: Breakdown;
  passivePerception: Breakdown;
  stealth: Breakdown;
  initiative: Breakdown;
  saves: Record<Ability, Breakdown>;
  /** Always-on flat bonuses to every attack's to-hit and damage. */
  toHitBonus: Part[];
  damageBonus: Part[];
  /** Conditional or non-numeric effects from bonuses, for display. */
  otherEffects: { source: string; effect: Effect }[];
}

function sum(parts: Part[]): Breakdown {
  return { total: parts.reduce((s, p) => s + p.value, 0), parts: parts.filter((p) => p.value !== 0) };
}

export function proficiencyOf(sb: StatBlock): number {
  return sb.proficiencyBonus ?? proficiencyForCr(sb.cr);
}

/** Always-on modifiers to one stat from a list of bonuses. */
function modifiersFor(bonuses: Bonus[], target: string): Part[] {
  const parts: Part[] = [];
  for (const b of bonuses) {
    for (const e of b.effects ?? []) {
      if (e.type === "modifier" && e.target === target && e.when.length === 0 && !e.dice) {
        parts.push({ label: b.source, value: e.value });
      }
    }
  }
  return parts;
}

export function deriveStats(sb: StatBlock, bonuses: Bonus[] = []): EffectiveStats {
  const abilities = {} as Record<Ability, Breakdown>;
  const mods = {} as Record<Ability, number>;
  for (const a of ABILITIES) {
    const parts: Part[] = [{ label: "Base", value: sb.abilities[a] }];
    for (const b of bonuses) if (b.abilities?.[a]) parts.push({ label: b.source, value: b.abilities[a]! });
    parts.push(...modifiersFor(bonuses, `ability:${a}`));
    const total = Math.min(30, Math.max(1, parts.reduce((s, p) => s + p.value, 0)));
    abilities[a] = { total, parts };
    mods[a] = abilityMod(total);
  }
  const pb = proficiencyOf(sb);

  const saves = {} as Record<Ability, Breakdown>;
  for (const a of ABILITIES) {
    saves[a] = sum([
      { label: `${a.toUpperCase()} modifier`, value: mods[a] },
      { label: "Proficiency", value: sb.saveProficiencies.includes(a) ? pb : 0 },
      ...modifiersFor(bonuses, `save:${a}`),
      ...modifiersFor(bonuses, "save:all"),
    ]);
  }

  // Constitution changes alter max HP by the change in modifier × number of hit dice.
  const hitDiceCount = Number(/^(\d+)d/.exec(sb.hitDice)?.[1] ?? 0);
  const conDelta = (mods.con - abilityMod(sb.abilities.con)) * hitDiceCount;

  const skill = (name: keyof typeof SKILL_ABILITY) => (sb.skills[name] ?? 0) * pb;

  const otherEffects: EffectiveStats["otherEffects"] = [];
  for (const b of bonuses) {
    for (const e of b.effects ?? []) {
      const counted = e.type === "modifier" && e.when.length === 0 && !e.dice && !e.target.startsWith("check:");
      if (!counted) otherEffects.push({ source: b.source, effect: e });
    }
  }

  return {
    abilities,
    mods,
    proficiency: pb,
    ac: sum([{ label: sb.acNote || "Base", value: sb.ac }, ...modifiersFor(bonuses, "ac")]),
    maxHp: sum([
      { label: "Base", value: sb.hp },
      { label: "CON change", value: conDelta },
      ...modifiersFor(bonuses, "hp"),
    ]),
    speed: sum([{ label: "Base", value: sb.speed.walk }, ...modifiersFor(bonuses, "speed")]),
    passivePerception: sum([
      { label: "Base", value: 10 },
      { label: "WIS modifier", value: mods.wis },
      { label: "Perception proficiency", value: skill("perception") },
      ...modifiersFor(bonuses, "perception"),
    ]),
    stealth: sum([
      { label: "DEX modifier", value: mods.dex },
      { label: "Stealth proficiency", value: skill("stealth") },
      ...modifiersFor(bonuses, "stealth"),
    ]),
    initiative: sum([{ label: "DEX modifier", value: mods.dex }, ...modifiersFor(bonuses, "initiative")]),
    saves,
    toHitBonus: modifiersFor(bonuses, "toHit"),
    damageBonus: modifiersFor(bonuses, "damage"),
    otherEffects,
  };
}

/** The to-hit bonus of an attack action with the given stats. */
export function attackBonus(action: StatAction, stats: EffectiveStats): Breakdown | null {
  if (action.profile.kind !== "attack") return null;
  const t = action.profile.toHit;
  return sum([
    { label: t.ability ? `${t.ability.toUpperCase()} modifier` : "Base", value: t.ability ? stats.mods[t.ability] : 0 },
    { label: "Proficiency", value: t.proficient ? stats.proficiency : 0 },
    { label: "Weapon", value: t.flat },
    ...stats.toHitBonus,
  ]);
}

/** "2d6 + 4 slashing plus 1d6 fire" for an attack or save action. */
export function damageText(action: StatAction, stats: EffectiveStats): string {
  const p = action.profile;
  if (p.kind !== "attack" && p.kind !== "save") return "";
  const extra = p.kind === "attack" ? stats.damageBonus.reduce((s, x) => s + x.value, 0) : 0;
  return p.damage
    .map((d, i) => {
      const bonus = (d.ability ? stats.mods[d.ability] : 0) + d.flat + (i === 0 ? extra : 0);
      return `${d.dice}${bonus ? ` ${bonus > 0 ? "+" : "−"} ${Math.abs(bonus)}` : ""} ${d.type}`;
    })
    .join(" plus ");
}

export function saveDcValue(dc: { ability: Ability | null; flat: number }, stats: EffectiveStats): number {
  return dc.ability ? 8 + stats.proficiency + stats.mods[dc.ability] + dc.flat : dc.flat;
}

/** Recruit cost and upkeep: the creature's override, else the first matching CR row. */
export function creatureCosts(c: Creature, r: Ruleset): { cost: ResourceAmounts; upkeep: ResourceAmounts; fromTable: boolean } {
  const row = r.settings.crCosts.find((x) => (x.category === "any" || x.category === c.category) && c.statBlock.cr <= x.maxCr);
  return {
    cost: c.costOverride ?? row?.cost ?? {},
    upkeep: c.upkeepOverride ?? row?.upkeep ?? {},
    fromTable: !c.costOverride || !c.upkeepOverride,
  };
}
