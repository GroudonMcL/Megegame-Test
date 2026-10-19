import { parseDice, rollDice } from "../dice";
import { createRng, type Rng } from "../rng";
import { DISABLING_CONDITIONS, type Ability, type Condition, type DamageType } from "../ruleset/common";
import { deriveStats, saveDcValue, unitBonuses, unitTags, type EffectiveStats } from "../ruleset/derive";
import type { Effect, EffectCondition } from "../ruleset/effects";
import { DEFAULT_FOOTPRINTS, type Creature } from "../ruleset/ruleset";
import type { ActionProfile, StatAction, StatBlock, Uses } from "../ruleset/statblock";
import { buildingTier, unitEffects } from "../orders/economy";
import type { WorldUnit } from "../world/types";
import { areaMultipliers } from "./area";
import { SRD_COMBAT_SPELLS } from "./srdSpells";
import type { CombatInput, CombatOdds, CombatResult, CombatSideInput, CombatUnitResult, LogEntry, LogKind } from "./types";

// A baseline simulation of a fight between units, in initiative order. Each
// unit is a group of creatures with one D&D stat block. The rules are
// simplified on purpose; docs/COMBAT.md explains every rule the DM can expect.

type Profile = ActionProfile;
type SaveProfile = Extract<Profile, { kind: "save" }>;
type AttackProfile = Extract<Profile, { kind: "attack" }>;
type HealProfile = Extract<Profile, { kind: "heal" }>;
type BuffProfile = Extract<Profile, { kind: "buff" }>;
type BuffKind = BuffProfile["effect"];

interface Option {
  /** What its uses are counted under (the action or spell name). */
  key: string;
  name: string;
  uses: Uses;
  profile: Profile;
  /** A Multiattack's attacks, in order. */
  routine?: StatAction[];
  spell: boolean;
  /** From a monster's Spellcasting action. */
  dcOverride?: number;
  attackOverride?: number | null;
  healMod?: number;
  cost?: number;
}

interface Side {
  id: string;
  teamId: string | null;
  name: string;
  surprising: boolean;
}

interface Buff {
  effect: BuffKind;
  amount: number;
  turnsLeft: number | null;
  source: string;
}

interface SaveInfo {
  save: Ability;
  orSave?: Ability;
  dc: number;
  spell: boolean;
}

interface Cond {
  condition: Condition;
  turnsLeft: number | null;
  save: SaveInfo | null;
  source: string;
}

interface Disabled {
  condition: Condition;
  /** Share of its damage the unit loses: 0.5, 0.75 or 1 at first. */
  penalty: number;
  turnsLeft: number | null;
  save: SaveInfo | null;
  source: string;
}

interface Fighter {
  id: string;
  unit: WorldUnit;
  side: Side;
  label: string;
  creature: Creature;
  sb: StatBlock;
  stats: EffectiveStats;
  /** The unit's own effects (race, archetype, augments, creature). */
  effects: Effect[];
  /** Effects from the region (buildings, settlement, features), multipliers applied. */
  regionEffects: Effect[];
  tags: string[];
  maxHp: number;
  startHp: number;
  hp: number;
  dead: boolean;
  out: null | "retreated" | "captured";
  footprint: number;
  initiative: number;
  dex: number;
  options: Option[];
  bonusOptions: Option[];
  legendary: { perRound: number; options: Option[] } | null;
  usesDay: Record<string, number>;
  usesCombat: Record<string, number>;
  recharge: Record<string, boolean>;
  effectUses: Map<Effect, number>;
  buffs: Buff[];
  conds: Cond[];
  disabled: Disabled | null;
  attacked: boolean;
  turns: number;
  dealt: number;
  taken: number;
  traits: {
    magicResistance: boolean;
    packTactics: boolean;
    regen: number;
    sneak: string | null;
    martial: string | null;
    legendaryRes: { key: string; times: number } | null;
    uncannyDodge: boolean;
    undeadFortitude: boolean;
  };
  extraUsedRound: number;
  dodgeUsedRound: number;
  retreatTo: string | null;
  forceMarching: boolean;
  raised?: { creatureId: string; teamId: string | null };
}

const COMBAT_TEXT = /damage|attack roll|attacks|saving throw|hit points|advantage/i;
const ATTACKED_WITH_ADVANTAGE: Condition[] = ["blinded", "restrained", "prone", "paralyzed", "stunned", "unconscious", "petrified"];
const ATTACKS_AT_DISADVANTAGE: Condition[] = ["poisoned", "frightened", "blinded", "restrained"];

function avgDice(expr: string): number {
  try {
    return parseDice(expr).reduce((s, t) => s + t.sign * (t.kind === "flat" ? t.value : ((t.keep?.n ?? t.count) * (t.sides + 1)) / 2), 0);
  } catch {
    return 0;
  }
}

/** Doubles every die in an expression, for critical hits. */
function critDice(expr: string): string {
  return expr.replace(/(\d*)d(\d+)/gi, (_, n, s) => `${(Number(n) || 1) * 2}d${s}`);
}

/** Adds n more dice of the expression's first kind ("2d6" + 1 → "3d6"). */
function moreDice(expr: string, n: number): string {
  if (!n) return expr;
  return expr.replace(/^(\d*)d(\d+)/i, (_, c, s) => `${(Number(c) || 1) + n}d${s}`);
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** The chance a d20 + bonus meets a target number, with advantage (+1) or disadvantage (−1). */
function chance(need: number, adv: number): number {
  const p = Math.min(0.95, Math.max(0.05, (21 - need) / 20));
  return adv > 0 ? 1 - (1 - p) ** 2 : adv < 0 ? p * p : p;
}

export function simulateCombat(input: CombatInput): CombatResult {
  const r = input.ruleset;
  const settings = r.settings.combat;
  const footprints = { ...DEFAULT_FOOTPRINTS, ...(settings.footprintFt ?? {}) };
  const rng: Rng = createRng(input.seed);
  const log: LogEntry[] = [];
  const warnings = new Set<string>();
  let round = 0;
  const say = (kind: LogKind, text: string) => log.push({ round, kind, text });

  const d20 = (adv: number) => {
    const a = rng.int(1, 20);
    if (adv === 0) return { nat: a, text: `${a}` };
    const b = rng.int(1, 20);
    const nat = adv > 0 ? Math.max(a, b) : Math.min(a, b);
    return { nat, text: `${a}/${b}${adv > 0 ? " adv" : " dis"}` };
  };
  const roll = (expr: string) => {
    try {
      return rollDice(expr, rng).total;
    } catch {
      return 0;
    }
  };

  // ——— Setting up the fighters ———

  const sides: Side[] = input.sides.map((s) => ({ id: s.id, teamId: s.teamId, name: s.name, surprising: Boolean(s.surprising) }));
  const fighters: Fighter[] = [];
  const region = input.region;
  const regionFortified = Boolean(region?.buildings.some((b) => buildingTier(r, b)?.tier.effects.some((e) => e.type === "modifier" && (e.target === "ac" || e.target === "toHit"))));

  function regionEffectsFor(teamId: string | null, tags: string[]): Effect[] {
    if (!region) return [];
    const out: Effect[] = [];
    const scale = (e: Effect): Effect => (e.type === "modifier" && e.tagMultiplier && tags.includes(e.tagMultiplier.tag) ? { ...e, value: e.value * e.tagMultiplier.factor } : e);
    if (teamId && region.ownerTeamId === teamId) {
      const tier = r.settlementTiers.find((t) => t.id === region.settlementTierId);
      for (const e of tier?.effects ?? []) out.push(scale(e));
      for (const b of region.buildings) for (const e of buildingTier(r, b)?.tier.effects ?? []) out.push(scale(e));
    }
    for (const e of region.features) out.push(scale(e));
    return out.filter((e) => e.type === "modifier" || e.type === "advantage");
  }

  function findSpell(name: string) {
    const own = r.spells.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (own && own.profile.kind !== "text") return { profile: own.profile, healAddsMod: false };
    return SRD_COMBAT_SPELLS[name.toLowerCase()] ?? null;
  }

  function optionsFrom(list: StatAction[], all: StatAction[], creatureName: string, stats: EffectiveStats, legendary = false): Option[] {
    const out: Option[] = [];
    const byName = (n: string) => all.find((a) => a.name.toLowerCase() === n.toLowerCase());
    for (const a of list) {
      const p = a.profile;
      switch (p.kind) {
        case "multiattack": {
          for (const opt of p.options) {
            const routine: StatAction[] = [];
            for (const item of opt) {
              const target = byName(item.action);
              if (target && (target.profile.kind === "attack" || target.profile.kind === "save")) for (let i = 0; i < item.count; i++) routine.push(target);
              else warnings.add(`${creatureName}: “${item.action}” in its Multiattack isn't automated.`);
            }
            if (routine.length) out.push({ key: a.name, name: a.name, uses: a.uses, profile: p, routine, spell: false, cost: a.cost });
          }
          break;
        }
        case "attack":
        case "save":
        case "heal":
        case "buff":
          out.push({ key: a.name, name: a.name, uses: a.uses, profile: p, spell: false, cost: a.cost });
          break;
        case "spellcasting":
          for (const s of p.spells) {
            const known = findSpell(s.name);
            if (!known) continue;
            out.push({
              key: s.name,
              name: s.name,
              uses: s.uses,
              profile: known.profile,
              spell: true,
              dcOverride: p.dc,
              attackOverride: p.attackBonus ?? stats.proficiency + stats.mods[p.ability],
              healMod: known.healAddsMod ? stats.mods[p.ability] : 0,
              cost: a.cost,
            });
          }
          break;
        case "text":
          if (!legendary || COMBAT_TEXT.test(a.text)) warnings.add(`${creatureName}: “${a.name}” isn't automated.`);
          break;
      }
    }
    return out;
  }

  function makeFighter(unit: WorldUnit, side: Side, sideInput: CombatSideInput | null, raised?: Fighter["raised"]): Fighter | null {
    const creature = r.creatures.find((c) => c.id === unit.creatureId);
    if (!creature) {
      warnings.add(`A unit of unknown type “${unit.creatureId}” was left out.`);
      return null;
    }
    const sb = creature.statBlock;
    const stats = deriveStats(sb, unitBonuses(r, unit));
    const effects = unitEffects(r, unit);
    const tags = unitTags(r, creature, unit.archetypeId);
    const name = sb.name;
    const granted = effects.flatMap((e) => (e.type === "grantAction" ? [e.action] : []));
    const allActions = [...sb.actions, ...granted];
    const options = optionsFrom(allActions, allActions, name, stats);
    for (const e of effects) {
      if (e.type !== "spells") continue;
      for (const id of e.spellIds) {
        const spell = r.spells.find((s) => s.id === id);
        if (!spell || spell.when !== "combat") continue;
        if (spell.profile.kind === "text") {
          warnings.add(`${name}: the spell “${spell.name}” isn't automated.`);
          continue;
        }
        options.push({ key: spell.id, name: spell.name, uses: e.uses, profile: spell.profile, spell: true });
      }
    }
    const bonusOptions = optionsFrom(sb.bonusActions, [...allActions, ...sb.bonusActions], name, stats);
    const legendary = sb.legendary ? { perRound: sb.legendary.perRound, options: optionsFrom(sb.legendary.actions, [...allActions, ...sb.legendary.actions], name, stats, true) } : null;

    const traitNamed = (n: string) => [...sb.traits, ...sb.reactions].find((t) => t.name.toLowerCase().startsWith(n));
    const regenText = traitNamed("regeneration")?.text ?? "";
    const legendaryRes = traitNamed("legendary resistance");
    const traits: Fighter["traits"] = {
      magicResistance: Boolean(traitNamed("magic resistance")),
      packTactics: Boolean(traitNamed("pack tactics")),
      regen: Number(/regains (\d+)/i.exec(regenText)?.[1] ?? 0),
      sneak: /(\d+d\d+)/.exec(traitNamed("sneak attack")?.text ?? "")?.[1] ?? null,
      martial: /(\d+d\d+)/.exec(traitNamed("martial advantage")?.text ?? "")?.[1] ?? null,
      legendaryRes: legendaryRes ? { key: legendaryRes.name, times: Number(/(\d+)\s*\/\s*day/i.exec(legendaryRes.name + legendaryRes.text)?.[1] ?? 3) } : null,
      uncannyDodge: Boolean(traitNamed("uncanny dodge")),
      undeadFortitude: Boolean(traitNamed("undead fortitude")),
    };
    const known = ["magic resistance", "pack tactics", "regeneration", "sneak attack", "martial advantage", "legendary resistance", "uncanny dodge", "undead fortitude"];
    for (const t of sb.traits) {
      if (known.some((k) => t.name.toLowerCase().startsWith(k))) continue;
      if (t.profile.kind === "text" && COMBAT_TEXT.test(t.text)) warnings.add(`${name}: the trait “${t.name}” isn't automated.`);
    }
    for (const e of effects) if (e.type === "text" && COMBAT_TEXT.test(e.text)) warnings.add(`${name}: “${e.text.split(":")[0]}” isn't automated.`);

    const maxHp = stats.maxHp.total;
    return {
      id: unit.id,
      unit,
      side,
      label: name,
      creature,
      sb,
      stats,
      effects,
      regionEffects: regionEffectsFor(side.teamId, tags),
      tags,
      maxHp,
      startHp: Math.min(unit.hp, maxHp),
      hp: Math.min(unit.hp, maxHp),
      dead: false,
      out: null,
      footprint: footprints[sb.size] ?? 30,
      initiative: 0,
      dex: stats.abilities.dex.total,
      options,
      bonusOptions,
      legendary,
      usesDay: { ...(unit.usesSpent ?? {}) },
      usesCombat: {},
      recharge: {},
      effectUses: new Map(),
      buffs: [],
      conds: [],
      disabled: null,
      attacked: false,
      turns: 0,
      dealt: 0,
      taken: 0,
      traits,
      extraUsedRound: 0,
      dodgeUsedRound: 0,
      retreatTo: sideInput?.retreatTo?.[unit.id] ?? null,
      forceMarching: Boolean(sideInput?.forceMarching?.includes(unit.id)),
      raised,
    };
  }

  input.sides.forEach((s, i) => {
    for (const u of s.units) {
      const f = makeFighter(u, sides[i], s);
      if (f) fighters.push(f);
    }
  });
  // "Goblin", "Goblin 2" or Goblin “Name” within a side, plus the side's name.
  function relabel() {
    const seen = new Map<string, number>();
    for (const f of fighters) {
      const key = `${f.side.id}:${f.sb.name}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const total = fighters.filter((g) => g.side === f.side && g.sb.name === f.sb.name).length;
      const own = f.unit.name.trim();
      const named = own.toLowerCase() === f.sb.name.toLowerCase() ? "" : own;
      f.label = `${f.sb.name}${named ? ` “${named}”` : total > 1 ? ` ${n}` : ""}${f.raised ? " (raised)" : ""} [${f.side.name}]`;
    }
  }
  relabel();

  // ——— Small helpers ———

  const active = (f: Fighter) => !f.dead && !f.out;
  const allies = (f: Fighter) => fighters.filter((g) => g.side === f.side && active(g));
  const enemies = (f: Fighter) => fighters.filter((g) => g.side !== f.side && active(g));
  const activeSides = () => new Set(fighters.filter(active).map((f) => f.side.id));

  function holds(f: Fighter, when: EffectCondition[], ctx: { target?: Fighter; spell?: boolean } = {}): boolean {
    return when.every((w) => {
      switch (w.when) {
        case "inOwnFortifiedRegion":
          return Boolean(f.side.teamId && region?.ownerTeamId === f.side.teamId && regionFortified);
        case "inOwnedRegion":
          return Boolean(f.side.teamId && region?.ownerTeamId === f.side.teamId);
        case "firstRound":
          return round === 1;
        case "surprising":
          return f.side.surprising;
        case "alliesOutnumber":
          return allies(f).length > enemies(f).length;
        case "outnumbered":
          return enemies(f).length > allies(f).length;
        case "forceMarching":
          return f.forceMarching;
        case "vsCreatureType":
          return Boolean(ctx.target && ctx.target.sb.creatureType.toLowerCase().includes(w.creatureType.toLowerCase()));
        case "alliedWithTag":
          return allies(f).some((g) => g !== f && g.tags.includes(w.tag));
        case "vsSpells":
          return Boolean(ctx.spell);
      }
    });
  }

  /** Bonuses to a stat that the stat block numbers don't already include. */
  function mod(f: Fighter, target: string, ctx: { target?: Fighter; spell?: boolean } = {}): number {
    let n = 0;
    const always = ["attacks", "saveDc", "damageDice"].includes(target) || target.startsWith("check:");
    for (const e of f.effects) if (e.type === "modifier" && e.target === target && !e.dice && (e.when.length > 0 || always) && holds(f, e.when, ctx)) n += e.value;
    for (const e of f.regionEffects) if (e.type === "modifier" && e.target === target && !e.dice && holds(f, e.when, ctx)) n += e.value;
    return n;
  }
  function extraDice(f: Fighter, ctx: { target?: Fighter }): string[] {
    return [...f.effects, ...f.regionEffects].flatMap((e) => (e.type === "modifier" && e.target === "damage" && e.dice && holds(f, e.when, ctx) ? [e.dice] : []));
  }
  function hasAdvantageEffect(f: Fighter, on: string[], mode: "advantage" | "disadvantage", ctx: { target?: Fighter; spell?: boolean } = {}) {
    return [...f.effects, ...f.regionEffects].some((e) => e.type === "advantage" && e.mode === mode && on.includes(e.on) && holds(f, e.when, ctx));
  }
  const buffTotal = (f: Fighter, kind: BuffKind) => f.buffs.filter((b) => b.effect === kind).reduce((s, b) => s + (b.amount || 1), 0);
  const hasBuff = (f: Fighter, kind: BuffKind) => f.buffs.some((b) => b.effect === kind);
  const hasCond = (f: Fighter, list: Condition[]) => f.conds.some((c) => list.includes(c.condition)) || Boolean(f.disabled && list.includes(f.disabled.condition));

  function ac(t: Fighter) {
    return t.stats.ac.total + mod(t, "ac") + buffTotal(t, "acBonus");
  }

  function attackAdvantage(f: Fighter, t: Fighter): number {
    let adv = 0;
    let dis = 0;
    if (hasAdvantageEffect(f, ["attacks"], "advantage", { target: t }) || hasBuff(f, "advantageAttacks")) adv++;
    if (hasAdvantageEffect(f, ["attacks"], "disadvantage", { target: t }) || hasBuff(f, "disadvantageAttacks")) dis++;
    if (hasAdvantageEffect(t, ["attacksAgainst"], "advantage") || hasBuff(t, "attackedWithAdvantage") || hasCond(t, ATTACKED_WITH_ADVANTAGE)) adv++;
    if (hasAdvantageEffect(t, ["attacksAgainst"], "disadvantage")) dis++;
    if (hasCond(f, ATTACKS_AT_DISADVANTAGE)) dis++;
    if (f.traits.packTactics && allies(f).length > 1) adv++;
    if (f.side.surprising && !f.attacked) adv++;
    if (f.forceMarching) dis++;
    return adv && !dis ? 1 : dis && !adv ? -1 : 0;
  }

  function toHitOf(f: Fighter, p: AttackProfile, o: Option | null, t: Fighter): number {
    if (o?.spell && o.attackOverride !== undefined && o.attackOverride !== null) return o.attackOverride + mod(f, "toHit", { target: t, spell: true });
    const th = p.toHit;
    const base = (th.ability ? f.stats.mods[th.ability] : 0) + (th.proficient ? f.stats.proficiency : 0) + th.flat;
    return base + f.stats.toHitBonus.reduce((s, x) => s + x.value, 0) + mod(f, "toHit", { target: t }) + buffTotal(f, "toHitBonus");
  }

  function adjustFor(t: Fighter, amount: number, type: DamageType) {
    if (t.sb.immunities.includes(type)) return 0;
    if (t.sb.resistances.includes(type)) amount = Math.floor(amount / 2);
    if (t.sb.vulnerabilities.includes(type)) amount *= 2;
    return amount;
  }

  function damageParts(f: Fighter, dmg: AttackProfile["damage"], t: Fighter, first: boolean): { dice: string; flat: number; type: DamageType }[] {
    return dmg.map((d, i) => ({
      dice: i === 0 && first ? moreDice(d.dice, mod(f, "damageDice", { target: t })) : d.dice,
      flat: (d.ability ? f.stats.mods[d.ability] : 0) + d.flat + (i === 0 && first ? f.stats.damageBonus.reduce((s, x) => s + x.value, 0) + mod(f, "damage", { target: t }) + buffTotal(f, "damageBonus") : 0),
      type: d.type,
    }));
  }

  // ——— Expected values, for choosing actions and targets ———

  function expectedAttack(f: Fighter, p: AttackProfile, o: Option | null, t: Fighter): number {
    const hit = chance(ac(t) - toHitOf(f, p, o, t), attackAdvantage(f, t));
    const parts = damageParts(f, p.damage, t, true);
    const avg = parts.reduce((s, x) => s + adjustFor(t, Math.max(0, avgDice(x.dice) + x.flat), x.type), 0);
    return hit * avg;
  }
  function saveBonus(t: Fighter, abilities: Ability[], spell: boolean) {
    return Math.max(...abilities.map((a) => t.stats.saves[a].total + mod(t, `save:${a}`, { spell }) + mod(t, "save:all", { spell })));
  }
  function failChance(t: Fighter, s: SaveInfo): number {
    const abilities = [s.save, ...(s.orSave ? [s.orSave] : [])];
    return 1 - chance(s.dc - saveBonus(t, abilities, s.spell), saveAdvantage(t, abilities, s.spell));
  }
  function dcOf(f: Fighter, dc: SaveProfile["dc"], o: Option | null): number {
    if (o?.dcOverride !== undefined && dc.flat < 100) return o.dcOverride + mod(f, "saveDc");
    return saveDcValue(dc, f.stats) + mod(f, "saveDc");
  }
  function expectedSave(f: Fighter, p: SaveProfile, o: Option | null, t: Fighter, mult = 1): number {
    const info: SaveInfo = { save: p.dc.save, orSave: p.dc.orSave, dc: dcOf(f, p.dc, o), spell: Boolean(o?.spell) };
    const fail = failChance(t, info);
    const avg = p.damage.reduce((s, d) => s + adjustFor(t, Math.max(0, avgDice(d.dice) + (d.ability ? f.stats.mods[d.ability] : 0) + d.flat) * mult, d.type), 0);
    let value = avg * (fail + (p.onSuccess === "half" ? (1 - fail) / 2 : 0));
    if (p.condition && !t.sb.conditionImmunities.includes(p.condition.condition) && !hasCond(t, [p.condition.condition])) {
      value += fail * threat(t) * (DISABLING_CONDITIONS.includes(p.condition.condition) ? 1.5 : 0.5);
    }
    return value;
  }
  const threatCache = new Map<Fighter, number>();
  /** Roughly how much damage a unit deals per turn. */
  function threat(f: Fighter): number {
    const cached = threatCache.get(f);
    if (cached !== undefined) return cached;
    let best = 0;
    for (const o of f.options) {
      if (o.profile.kind === "multiattack" && o.routine) {
        best = Math.max(best, o.routine.reduce((s, a) => s + (a.profile.kind === "attack" ? avgOf(f, a.profile.damage) * 0.6 : 0), 0));
      } else if (o.profile.kind === "attack") best = Math.max(best, avgOf(f, o.profile.damage) * 0.6);
    }
    threatCache.set(f, best || 1);
    return best || 1;
  }
  function avgOf(f: Fighter, dmg: AttackProfile["damage"]) {
    return dmg.reduce((s, d) => s + avgDice(d.dice) + (d.ability ? f.stats.mods[d.ability] : 0) + d.flat, 0);
  }

  // ——— Uses ———

  function usable(f: Fighter, o: Option): boolean {
    switch (o.uses.type) {
      case "atWill":
        return true;
      case "recharge":
        return f.recharge[o.key] !== false;
      case "perCombat":
        return (f.usesCombat[o.key] ?? 0) < o.uses.times;
      case "perDay":
        return (settings.usesReset === "round" ? (f.usesDay[o.key] ?? 0) : (f.usesCombat[o.key] ?? 0)) < o.uses.times;
    }
  }
  function spend(f: Fighter, o: Option) {
    if (o.uses.type === "recharge") f.recharge[o.key] = false;
    else if (o.uses.type === "perCombat" || (o.uses.type === "perDay" && settings.usesReset === "combat")) f.usesCombat[o.key] = (f.usesCombat[o.key] ?? 0) + 1;
    else if (o.uses.type === "perDay") f.usesDay[o.key] = (f.usesDay[o.key] ?? 0) + 1;
  }
  function effectUse(f: Fighter, e: Effect & { times: number }): boolean {
    const used = f.effectUses.get(e) ?? 0;
    if (used >= e.times) return false;
    f.effectUses.set(e, used + 1);
    return true;
  }

  // ——— Saving throws and conditions ———

  function saveAdvantage(t: Fighter, abilities: Ability[], spell: boolean): number {
    const on = ["saves", ...abilities.map((a) => `save:${a}`)];
    let adv = hasAdvantageEffect(t, on, "advantage", { spell }) || hasBuff(t, "advantageSaves") || (spell && t.traits.magicResistance) ? 1 : 0;
    let dis = hasAdvantageEffect(t, on, "disadvantage", { spell }) || hasBuff(t, "disadvantageSaves") || t.forceMarching ? 1 : 0;
    if (adv && dis) adv = dis = 0;
    return adv - dis;
  }

  function rollSave(t: Fighter, s: SaveInfo, important: boolean) {
    const abilities = [s.save, ...(s.orSave ? [s.orSave] : [])];
    const bonus = saveBonus(t, abilities, s.spell);
    const die = d20(saveAdvantage(t, abilities, s.spell));
    const total = die.nat + bonus;
    let success = total >= s.dc;
    let note = "";
    if (!success && important) {
      const auto = t.effects.find((e): e is Extract<Effect, { type: "autoSucceedSave" }> => e.type === "autoSucceedSave" && (usesLeft(t, e) > 0));
      if (auto && effectUse(t, auto)) {
        success = true;
        note = " (turned into a success)";
      } else if (t.traits.legendaryRes && (t.usesDay[t.traits.legendaryRes.key] ?? 0) < t.traits.legendaryRes.times) {
        t.usesDay[t.traits.legendaryRes.key] = (t.usesDay[t.traits.legendaryRes.key] ?? 0) + 1;
        success = true;
        note = " (Legendary Resistance)";
      }
    }
    const label = abilities.map((a) => a.toUpperCase()).join("/");
    return { success, total, nat: die.nat, margin: s.dc - total, text: `${label} save ${die.text}${bonus >= 0 ? "+" : ""}${bonus} = ${total} vs DC ${s.dc}: ${success ? "success" : "fail"}${note}` };
  }
  function usesLeft(f: Fighter, e: Effect & { times: number }) {
    return e.times - (f.effectUses.get(e) ?? 0);
  }

  /** How badly a failed save went → the share of damage lost (0.5 / 0.75 / 1). */
  const scale = (margin: number, nat: number) => (nat === 1 || margin >= 10 ? 1 : margin >= 5 ? 0.75 : 0.5);

  function applyCondition(t: Fighter, c: { condition: Condition; durationRounds: number | null; repeatSave: boolean }, save: { margin: number; nat: number; info: SaveInfo } | null, source: string) {
    if (t.sb.conditionImmunities.includes(c.condition)) {
      say("condition", `${t.label} is immune to being ${c.condition}.`);
      return;
    }
    if (DISABLING_CONDITIONS.includes(c.condition)) {
      const penalty = save ? scale(save.margin, save.nat) : 1;
      if (t.disabled && t.disabled.penalty >= penalty) return;
      t.disabled = { condition: c.condition, penalty, turnsLeft: c.durationRounds ?? (save ? null : 1), save: save?.info ?? null, source };
      say("condition", `${t.label} is ${c.condition} by ${source}: ${penalty === 1 ? "it loses its turns" : `its damage is cut by ${pct(penalty)}`} until it shakes it off.`);
      return;
    }
    t.conds.push({ condition: c.condition, turnsLeft: c.durationRounds, save: c.repeatSave && save ? save.info : null, source });
    say("condition", `${t.label} is ${c.condition} by ${source}.`);
  }

  // ——— Damage ———

  const pendingRaises: { side: Side; creatureId: string; from: Fighter }[] = [];

  function dealDamage(src: Fighter, t: Fighter, parts: { amount: number; type: DamageType }[], opts: { mult?: number; crit?: boolean } = {}): number {
    let total = 0;
    for (const p of parts) total += adjustFor(t, Math.floor(p.amount * (opts.mult ?? 1)), p.type);
    if (src.disabled) total = Math.round(total * (1 - src.disabled.penalty));
    const notes: string[] = [];
    if (total > 0) {
      const reduce = t.effects.find((e): e is Extract<Effect, { type: "reduceDamage" }> => e.type === "reduceDamage" && usesLeft(t, e) > 0);
      if (reduce && effectUse(t, reduce)) {
        total = reduce.mode === "halve" ? Math.floor(total / 2) : Math.max(0, total - reduce.amount);
        notes.push(reduce.mode === "halve" ? "halved" : `reduced by ${reduce.amount}`);
      } else if (t.traits.uncannyDodge && t.dodgeUsedRound !== round) {
        t.dodgeUsedRound = round;
        total = Math.floor(total / 2);
        notes.push("halved by Uncanny Dodge");
      }
    }
    t.hp -= total;
    t.taken += total;
    src.dealt += total;
    const life = src.effects.find((e) => e.type === "lifesteal");
    if (life?.type === "lifesteal" && total > 0 && active(src)) src.hp = Math.min(src.maxHp, src.hp + Math.floor(total * life.fraction));
    if (t.hp <= 0) {
      if (t.traits.undeadFortitude && !parts.some((p) => p.type === "radiant") && !opts.crit) {
        const res = rollSave(t, { save: "con", dc: 5 + total, spell: false }, false);
        if (res.success) {
          t.hp = 1;
          notes.push(`Undead Fortitude keeps it at 1 HP (${res.text})`);
        }
      }
    }
    if (t.hp <= 0) {
      t.hp = 0;
      t.dead = true;
      t.disabled = null;
      notes.push("it is destroyed");
      raiseFrom(src, t);
    } else if (total > 0 && t.disabled?.condition === "unconscious") {
      t.disabled = null;
      notes.push("it wakes up");
    }
    lastNotes = notes;
    return total;
  }
  let lastNotes: string[] = [];
  const noteText = () => (lastNotes.length ? `, ${lastNotes.join(", ")}` : "");

  function raiseFrom(src: Fighter, dead: Fighter) {
    for (const g of fighters) {
      if (g.side !== src.side || !active(g)) continue;
      for (const e of g.effects) {
        if (e.type !== "raiseSlain" || !dead.sb.creatureType.toLowerCase().includes(e.creatureType.toLowerCase())) continue;
        if (!r.creatures.some((c) => c.id === e.asCreatureId) || !effectUse(g, e)) continue;
        pendingRaises.push({ side: src.side, creatureId: e.asCreatureId, from: g });
        return;
      }
    }
  }

  // ——— Targeting ———

  function priorityFor(f: Fighter): Fighter | null {
    const id = input.priority?.[f.side.id];
    const t = id ? fighters.find((g) => g.id === id) : undefined;
    return t && active(t) && t.side !== f.side ? t : null;
  }
  function canHurt(f: Fighter, t: Fighter, dmg: { type: DamageType }[]) {
    return !dmg.length || dmg.some((d) => !t.sb.immunities.includes(d.type));
  }
  /** Weapon attacks go for the weakest enemy they can hurt. */
  function weakest(f: Fighter, dmg: { type: DamageType }[]): Fighter | null {
    const p = priorityFor(f);
    if (p && canHurt(f, p, dmg)) return p;
    const list = enemies(f).filter((t) => canHurt(f, t, dmg));
    return list.sort((a, b) => a.hp - b.hp || a.maxHp - b.maxHp)[0] ?? null;
  }
  /** Damage spells and area effects go for the toughest enemy. */
  function toughest(f: Fighter, dmg: { type: DamageType }[], exclude: Fighter[] = []): Fighter[] {
    const list = enemies(f)
      .filter((t) => canHurt(f, t, dmg) && !exclude.includes(t))
      .sort((a, b) => b.hp - a.hp || b.footprint - a.footprint);
    const p = priorityFor(f);
    if (p && list.includes(p)) return [p, ...list.filter((t) => t !== p)];
    return list;
  }
  function areaTargets(f: Fighter, p: SaveProfile): { t: Fighter; mult: number }[] {
    const list = toughest(f, p.damage);
    if (!p.area) return list.slice(0, p.targets).map((t) => ({ t, mult: 1 }));
    const mults = areaMultipliers(p.area, list.map((t) => t.footprint));
    return mults.map((mult, i) => ({ t: list[i], mult }));
  }
  function controlTarget(f: Fighter, p: SaveProfile | BuffProfile): Fighter | null {
    const cond = p.kind === "save" ? p.condition?.condition : undefined;
    const list = enemies(f)
      .filter((t) => (cond ? !t.sb.conditionImmunities.includes(cond) && !hasCond(t, [cond]) : p.kind === "buff" ? !hasBuff(t, p.effect) : true))
      .sort((a, b) => threat(b) * b.hp - threat(a) * a.hp);
    const pr = priorityFor(f);
    return pr && list.includes(pr) ? pr : (list[0] ?? null);
  }

  // ——— Actions ———

  function routineOf(f: Fighter, o: Option): StatAction[] {
    const base = o.routine ?? (o.profile.kind === "attack" ? [{ name: o.name, text: "", uses: o.uses, profile: o.profile, review: "auto" } as StatAction] : []);
    const extra = Math.max(0, mod(f, "attacks") + buffTotal(f, "extraAttack"));
    const firstAttack = base.find((a) => a.profile.kind === "attack");
    return firstAttack ? [...base, ...Array.from({ length: extra }, () => firstAttack)] : base;
  }

  function score(f: Fighter, o: Option): number {
    const p = o.profile;
    if (p.kind === "multiattack" || p.kind === "attack") {
      let total = 0;
      for (const a of routineOf(f, o)) {
        if (a.profile.kind === "attack") {
          const t = weakest(f, a.profile.damage);
          if (t) total += expectedAttack(f, a.profile, o.spell ? o : null, t);
        } else if (a.profile.kind === "save") {
          const t = toughest(f, a.profile.damage)[0];
          if (t) total += expectedSave(f, a.profile, null, t);
        }
      }
      return total;
    }
    if (p.kind === "save") {
      if (!p.damage.length) {
        const t = controlTarget(f, p);
        return t ? expectedSave(f, p, o, t) : 0;
      }
      return areaTargets(f, p).reduce((s, x) => s + expectedSave(f, p, o, x.t, x.mult), 0);
    }
    if (p.kind === "buff" && p.target === "enemy") {
      const t = controlTarget(f, p);
      if (!t) return 0;
      const fail = p.save ? failChance(t, { save: p.save.save, orSave: p.save.orSave, dc: saveDcValue(p.save, f.stats) + mod(f, "saveDc"), spell: o.spell }) : 1;
      return fail * threat(t) * 0.5;
    }
    return 0;
  }

  function doAttack(f: Fighter, a: StatAction, p: AttackProfile, o: Option | null, t: Fighter) {
    const adv = attackAdvantage(f, t);
    const toHit = toHitOf(f, p, o, t);
    const die = d20(adv);
    const total = die.nat + toHit;
    const targetAc = ac(t);
    const hit = die.nat === 20 || (die.nat !== 1 && total >= targetAc);
    const crit = die.nat === 20;
    f.attacked = true;
    if (!hit) {
      say("attack", `${f.label} → ${t.label}: ${a.name} ${die.text}${toHit >= 0 ? "+" : ""}${toHit} = ${total} vs AC ${targetAc}, miss.`);
      return;
    }
    const parts = damageParts(f, p.damage, t, true).map((x) => ({ amount: Math.max(0, roll(crit ? critDice(x.dice) : x.dice) + x.flat), type: x.type }));
    for (const dice of extraDice(f, { target: t })) parts.push({ amount: roll(crit ? critDice(dice) : dice), type: p.damage[0]?.type ?? "bludgeoning" });
    const once = f.traits.sneak ?? f.traits.martial;
    if (once && f.extraUsedRound !== round && (f.traits.sneak ? adv > 0 || allies(f).length > 1 : allies(f).length > 1)) {
      f.extraUsedRound = round;
      parts.push({ amount: roll(crit ? critDice(once) : once), type: p.damage[0]?.type ?? "bludgeoning" });
    }
    const dmg = dealDamage(f, t, parts, { crit });
    say("attack", `${f.label} → ${t.label}: ${a.name} ${die.text}${toHit >= 0 ? "+" : ""}${toHit} = ${total} vs AC ${targetAc}, ${crit ? "critical hit" : "hit"} for ${dmg} (${t.hp}/${t.maxHp} HP)${noteText()}.`);
    if (!active(t)) return;
    if (p.onHitCondition) {
      if (p.onHitSave) {
        const info: SaveInfo = { save: p.onHitSave.save, orSave: p.onHitSave.orSave, dc: saveDcValue(p.onHitSave, f.stats) + mod(f, "saveDc"), spell: false };
        const res = rollSave(t, info, true);
        say("save", `${t.label} vs ${a.name}: ${res.text}.`);
        if (!res.success) applyCondition(t, p.onHitCondition, { margin: res.margin, nat: res.nat, info }, a.name);
      } else applyCondition(t, p.onHitCondition, null, a.name);
    }
  }

  function doSaveEffect(f: Fighter, name: string, p: SaveProfile, o: Option | null, targets: { t: Fighter; mult: number }[]) {
    const info: SaveInfo = { save: p.dc.save, orSave: p.dc.orSave, dc: dcOf(f, p.dc, o), spell: Boolean(o?.spell) };
    const rolled = p.damage.map((d) => ({ amount: Math.max(0, roll(d.dice) + (d.ability ? f.stats.mods[d.ability] : 0) + d.flat), type: d.type }));
    const sum = rolled.reduce((s, x) => s + x.amount, 0);
    say("save", `${f.label} uses ${name}${p.area ? ` (${p.area.size} ft ${p.area.shape})` : ""}${rolled.length ? `: ${sum} damage rolled` : ""}.`);
    for (const { t, mult } of targets) {
      if (!active(t)) continue;
      const important = !rolled.length || sum * mult >= t.hp / 4 || Boolean(p.condition);
      const res = rollSave(t, info, important);
      let text = `  ${t.label}${mult !== 1 ? ` (×${mult})` : ""}: ${res.text}`;
      if (rolled.length) {
        const share = res.success ? (p.onSuccess === "half" ? 0.5 : 0) : 1;
        if (share > 0) {
          const dmg = dealDamage(
            f,
            t,
            rolled.map((x) => ({ ...x, amount: x.amount * share })),
            { mult },
          );
          text += `, takes ${dmg} (${t.hp}/${t.maxHp} HP)${noteText()}`;
        } else text += ", no damage";
      }
      say("save", `${text}.`);
      if (!res.success && p.condition && active(t)) applyCondition(t, p.condition, { margin: res.margin, nat: res.nat, info }, name);
    }
  }

  function doHeal(f: Fighter, o: Option, p: HealProfile, targets: Fighter[]) {
    for (const t of targets) {
      let amount = Math.max(0, roll(p.dice) + (p.ability ? f.stats.mods[p.ability] : 0) + p.flat + (o.healMod ?? 0));
      if (f.disabled) amount = Math.round(amount * (1 - f.disabled.penalty));
      if (t.dead) {
        t.dead = false;
        t.hp = Math.max(1, Math.min(t.maxHp, amount));
        say("heal", `${f.label} uses ${o.name}: ${t.label} returns to the fight with ${t.hp} HP.`);
      } else {
        const before = t.hp;
        t.hp = Math.min(t.maxHp, t.hp + amount);
        say("heal", `${f.label} uses ${o.name} on ${t.label}: +${t.hp - before} HP (${t.hp}/${t.maxHp}).`);
      }
    }
  }

  function doBuff(f: Fighter, o: Option, p: BuffProfile, t: Fighter) {
    if (p.target === "enemy" && p.save) {
      const info: SaveInfo = { save: p.save.save, orSave: p.save.orSave, dc: saveDcValue(p.save, f.stats) + mod(f, "saveDc"), spell: o.spell };
      const res = rollSave(t, info, true);
      say("buff", `${f.label} uses ${o.name} on ${t.label}: ${res.text}.`);
      if (res.success) return;
    } else say("buff", `${f.label} uses ${o.name} on ${t.label}.`);
    t.buffs.push({ effect: p.effect, amount: p.amount, turnsLeft: p.durationRounds, source: o.name });
  }

  function healNeed(f: Fighter, p: HealProfile): Fighter[] {
    if (p.revive) {
      const dead = fighters.filter((g) => g.side === f.side && g.dead && !g.out);
      if (dead.length) return dead.sort((a, b) => threat(b) - threat(a)).slice(0, p.targets);
    }
    return allies(f)
      .filter((g) => g.hp < g.maxHp / 2)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, p.targets);
  }

  function takeOption(f: Fighter, o: Option): boolean {
    const p = o.profile;
    switch (p.kind) {
      case "multiattack":
      case "attack": {
        let any = false;
        for (const a of routineOf(f, o)) {
          if (!active(f) || !enemies(f).length) break;
          if (a.profile.kind === "attack") {
            const t = weakest(f, a.profile.damage);
            if (!t) continue;
            doAttack(f, a, a.profile, o.spell ? o : null, t);
            any = true;
          } else if (a.profile.kind === "save") {
            const targets = areaTargets(f, a.profile);
            if (!targets.length) continue;
            doSaveEffect(f, a.name, a.profile, null, targets);
            any = true;
          }
        }
        return any;
      }
      case "save": {
        const targets = p.damage.length ? areaTargets(f, p) : (() => {
          const t = controlTarget(f, p);
          return t ? [{ t, mult: 1 }] : [];
        })();
        if (!targets.length) return false;
        doSaveEffect(f, o.name, p, o, targets);
        return true;
      }
      case "heal": {
        const targets = healNeed(f, p);
        if (!targets.length) return false;
        doHeal(f, o, p, targets);
        return true;
      }
      case "buff": {
        const t = p.target === "self" ? f : p.target === "ally" ? allies(f).filter((g) => !hasBuff(g, p.effect)).sort((a, b) => threat(b) - threat(a))[0] : controlTarget(f, p);
        if (!t) return false;
        doBuff(f, o, p, t);
        return true;
      }
      default:
        return false;
    }
  }

  function pickAndUse(f: Fighter, options: Option[], firstTurn: boolean): boolean {
    const ready = options.filter((o) => usable(f, o));
    // Healers heal allies below half HP (or bring back the fallen).
    for (const o of ready) if (o.profile.kind === "heal" && healNeed(f, o.profile).length && takeOption(f, o)) return spendAnd(f, o);
    // Buffers buff their strongest ally on their first turn.
    if (firstTurn) for (const o of ready) if (o.profile.kind === "buff" && o.profile.target !== "enemy" && takeOption(f, o)) return spendAnd(f, o);
    // Otherwise whatever is expected to do the most.
    let best: Option | null = null;
    let bestScore = 0;
    for (const o of ready) {
      const s = score(f, o);
      if (s > bestScore + 1e-9) {
        best = o;
        bestScore = s;
      }
    }
    if (best && takeOption(f, best)) return spendAnd(f, best);
    return false;
  }
  function spendAnd(f: Fighter, o: Option) {
    spend(f, o);
    return true;
  }

  function tryCapture(f: Fighter): boolean {
    const cap = input.capture;
    if (!cap || cap.sideId !== f.side.id) return false;
    const t = fighters.find((g) => g.id === cap.targetId);
    if (!t || !active(t) || t.hp >= t.maxHp / 4 || enemies(f).length !== 1) return false;
    const dc = 8 + f.stats.mods.str + f.stats.proficiency + mod(f, "check:capture");
    const helped = hasAdvantageEffect(f, ["check:capture"], "advantage");
    const info: SaveInfo = { save: t.stats.saves.str.total >= t.stats.saves.dex.total ? "str" : "dex", dc, spell: false };
    const bonus = t.stats.saves[info.save].total;
    const die = d20(helped ? -1 : 0);
    const total = die.nat + bonus;
    const caught = total < dc;
    say("capture", `${f.label} tries to capture ${t.label}: ${info.save.toUpperCase()} save ${die.text}${bonus >= 0 ? "+" : ""}${bonus} = ${total} vs DC ${dc}: ${caught ? "captured!" : "it breaks free"}.`);
    if (caught) t.out = "captured";
    return true;
  }

  function startTurn(f: Fighter) {
    if (f.traits.regen && f.hp < f.maxHp) {
      f.hp = Math.min(f.maxHp, f.hp + f.traits.regen);
      say("heal", `${f.label} regenerates ${f.traits.regen} HP (${f.hp}/${f.maxHp}).`);
    }
    for (const o of [...f.options, ...f.bonusOptions, ...(f.legendary?.options ?? [])]) {
      if (o.uses.type === "recharge" && f.recharge[o.key] === false) {
        const d = rng.int(1, 6);
        if (d >= o.uses.min) {
          f.recharge[o.key] = true;
          say("info", `${f.label}'s ${o.name} recharges (${d}).`);
        }
      }
    }
  }

  function endTurn(f: Fighter) {
    f.turns++;
    const dis = f.disabled;
    if (dis) {
      if (dis.turnsLeft !== null && --dis.turnsLeft <= 0) {
        f.disabled = null;
        say("condition", `${f.label} is no longer ${dis.condition}.`);
      } else if (dis.save) {
        const res = rollSave(f, dis.save, false);
        if (res.success) {
          f.disabled = null;
          say("condition", `${f.label} shakes off being ${dis.condition}: ${res.text}.`);
        } else {
          dis.penalty *= scale(res.margin, res.nat);
          if (dis.penalty < 0.1) {
            f.disabled = null;
            say("condition", `${f.label} has mostly shaken off being ${dis.condition}.`);
          } else say("condition", `${f.label} is still ${dis.condition} (${res.text}): damage cut by ${pct(dis.penalty)}.`);
        }
      }
    }
    f.conds = f.conds.filter((c) => {
      if (c.turnsLeft !== null && --c.turnsLeft <= 0) return false;
      if (c.save) {
        const res = rollSave(f, c.save, false);
        if (res.success) {
          say("condition", `${f.label} is no longer ${c.condition}: ${res.text}.`);
          return false;
        }
      }
      return true;
    });
    f.buffs = f.buffs.filter((b) => b.turnsLeft === null || --b.turnsLeft > 0);
  }

  function shouldRetreat(f: Fighter) {
    return Boolean(f.side.teamId && f.retreatTo && settings.retreatBelow > 0 && f.hp < f.maxHp * settings.retreatBelow);
  }

  // ——— The fight ———

  const result = (endReason: CombatResult["endReason"], winner: string | null): CombatResult => ({
    seed: input.seed,
    regionId: region?.id ?? null,
    sides: sides.map(({ id, teamId, name }) => ({ id, teamId, name })),
    rounds: round,
    winner,
    endReason,
    log,
    units: fighters.map(
      (f): CombatUnitResult => ({
        unitId: f.id,
        sideId: f.side.id,
        label: f.label,
        startHp: f.startHp,
        hp: f.hp,
        maxHp: f.maxHp,
        outcome: f.dead ? "dead" : (f.out ?? "standing"),
        retreatTo: f.out === "retreated" ? f.retreatTo : null,
        damageDealt: f.dealt,
        damageTaken: f.taken,
        usesSpent: f.usesDay,
        raised: f.raised,
      }),
    ),
    warnings: [...warnings],
  });

  if (activeSides().size < 2) return result("noFight", [...activeSides()][0] ?? null);

  // Initiative.
  for (const f of fighters) {
    const adv = f.side.surprising || hasAdvantageEffect(f, ["initiative"], "advantage") ? 1 : 0;
    const die = d20(adv);
    const bonus = f.stats.initiative.total + mod(f, "initiative");
    f.initiative = die.nat + bonus;
  }
  const order = [...fighters].sort((a, b) => b.initiative - a.initiative || b.dex - a.dex);
  say("initiative", `Initiative: ${order.map((f) => `${f.label} ${f.initiative}`).join(", ")}.`);
  for (const s of sides) if (s.surprising) say("info", `${s.name} attacks by surprise: advantage on initiative and on each unit's first attack.`);

  let raisedCount = 0;
  let captured = false;
  const over = () => captured || activeSides().size < 2;
  for (round = 1; round <= settings.maxRounds && !over(); round++) {
    say("round", `Round ${round}`);
    for (const p of pendingRaises.splice(0)) {
      raisedCount++;
      const unit: WorldUnit = {
        id: `new:${raisedCount}`,
        ownerTeamId: p.side.teamId,
        creatureId: p.creatureId,
        name: "",
        raceId: null,
        archetypeId: null,
        academyBonus: {},
        augmentIds: [],
        hp: r.creatures.find((c) => c.id === p.creatureId)!.statBlock.hp,
        regionId: region?.id ?? null,
        x: null,
        y: null,
        milesUsed: 0,
        status: "active",
        isLeader: false,
        usesSpent: {},
      };
      const f = makeFighter(unit, p.side, null, { creatureId: p.creatureId, teamId: p.side.teamId });
      if (!f) continue;
      fighters.push(f);
      order.push(f);
      relabel();
      say("info", `${p.from.label} raises the fallen as ${f.label}.`);
    }
    for (const f of [...order]) {
      if (!active(f) || over()) continue;
      startTurn(f);
      if (shouldRetreat(f)) {
        f.out = "retreated";
        say("retreat", `${f.label} retreats at ${f.hp}/${f.maxHp} HP.`);
        continue;
      }
      if (f.disabled && f.disabled.penalty >= 1) say("condition", `${f.label} is ${f.disabled.condition} and loses its turn.`);
      else if (tryCapture(f)) captured = fighters.some((g) => g.out === "captured");
      else {
        const acted = pickAndUse(f, f.options, f.turns === 0);
        if (!acted && enemies(f).length) say("info", `${f.label} can't do anything useful.`);
        if (active(f) && enemies(f).length && f.bonusOptions.length) pickAndUse(f, f.bonusOptions, false);
      }
      endTurn(f);
    }
    // Legendary actions at the end of the round.
    for (const f of order) {
      if (!f.legendary || !active(f) || over() || (f.disabled && f.disabled.penalty >= 1)) continue;
      let budget = f.legendary.perRound;
      for (let i = 0; i < 6 && budget > 0 && !over(); i++) {
        const choices = f.legendary.options.filter((o) => (o.cost ?? 1) <= budget && usable(f, o));
        const best = choices.map((o) => ({ o, s: score(f, o) })).sort((a, b) => b.s - a.s)[0];
        if (!best || best.s <= 0) break;
        takeOption(f, best.o);
        spend(f, best.o);
        budget -= best.o.cost ?? 1;
      }
    }
  }
  round = Math.min(round, settings.maxRounds + 1) - 1;
  if (captured) return result("captured", input.capture!.sideId);
  const left = [...activeSides()];
  if (left.length < 2) {
    const winner = left[0] ?? null;
    say("info", winner ? `${sides.find((s) => s.id === winner)?.name} win${sides.find((s) => s.id === winner)?.name.endsWith("s") ? "" : "s"} the fight.` : "Nobody is left standing.");
    return result("wipedOut", winner);
  }
  say("info", `After ${settings.maxRounds} rounds the fight is undecided.`);
  return result("maxRounds", null);
}

/** Runs the same fight many times with different dice and sums up how it tends to go. */
export function combatOdds(input: CombatInput, runs = input.ruleset.settings.combat.oddsRuns): CombatOdds {
  const results: CombatResult[] = [];
  for (let i = 0; i < runs; i++) results.push(simulateCombat({ ...input, seed: `${input.seed}:odds:${i}` }));
  return summariseOdds(results);
}

/** Win rates, losses and HP left over many runs of the same fight. */
export function summariseOdds(results: CombatResult[]): CombatOdds {
  const runs = results.length;
  const wins: Record<string, number> = {};
  const losses: Record<string, number> = {};
  const hpLeft: Record<string, number> = {};
  let draws = 0;
  let rounds = 0;
  for (const res of results) {
    if (res.winner) wins[res.winner] = (wins[res.winner] ?? 0) + 1;
    else draws++;
    rounds += res.rounds;
    for (const side of res.sides) {
      const mine = res.units.filter((u) => u.sideId === side.id && !u.raised);
      const start = mine.reduce((sum, u) => sum + u.startHp, 0);
      losses[side.id] = (losses[side.id] ?? 0) + mine.filter((u) => u.outcome === "dead" || u.outcome === "captured").length;
      hpLeft[side.id] = (hpLeft[side.id] ?? 0) + (start ? mine.reduce((sum, u) => sum + (u.outcome === "captured" ? 0 : u.hp), 0) / start : 0);
      wins[side.id] ??= 0;
    }
  }
  const avg = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, runs ? v / runs : 0]));
  return { runs, wins: avg(wins), draws: runs ? draws / runs : 0, losses: avg(losses), hpLeft: avg(hpLeft), rounds: runs ? rounds / runs : 0 };
}
