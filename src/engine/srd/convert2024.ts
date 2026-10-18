import {
  ABILITIES,
  abilityMod,
  CONDITIONS,
  DAMAGE_TYPES,
  proficiencyForCr,
  type Ability,
  type Condition,
  type DamageType,
} from "../ruleset/common";
import {
  AREA_SHAPES,
  SKILL_ABILITY,
  SKILLS,
  StatBlock,
  type ActionProfile,
  type Area,
  type DamageRoll,
  type StatAction,
  type Uses,
} from "../ruleset/statblock";

// Converts one monster from the 5e-bits "5e-database" SRD 5.2 (2024) JSON into
// our stat block format. The structured fields are used where present; the
// highly regular 2024 action text fills the gaps ("Dexterity Saving Throw:
// DC 21, each creature in a 60-foot Cone. Failure: …").

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

export interface ConvertedMonster {
  index: string;
  name: string;
  statBlock: StatBlock;
}

/** Traits the combat engine will understand by name, or that never matter in a fight. */
export const KNOWN_TRAITS = new Set([
  "Magic Resistance",
  "Pack Tactics",
  "Legendary Resistance",
  "Regeneration",
  "Undead Fortitude",
  "Amphibious",
  "Spider Climb",
  "Web Walker",
  "Sunlight Sensitivity",
  "Keen Senses",
  "Keen Smell",
  "Keen Hearing and Smell",
  "Keen Sight",
  "Flyby",
  "Water Breathing",
  "Hold Breath",
  "Siege Monster",
  "Illumination",
  "Unusual Nature",
  "Incorporeal Movement",
]);

const ABILITY_BY_WORD: Record<string, Ability> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

function feet(v: unknown): number {
  const m = /(\d+)/.exec(String(v ?? ""));
  return m ? Number(m[1]) : 0;
}

function damageType(raw: Raw): DamageType | null {
  const idx = String(raw?.index ?? raw ?? "").toLowerCase();
  return (DAMAGE_TYPES as readonly string[]).includes(idx) ? (idx as DamageType) : null;
}

/** "1d10+8" → { dice: "1d10", bonus: 8 } */
function splitDice(expr: string): { dice: string; bonus: number } {
  const clean = expr.replace(/\s+/g, "");
  const m = /^(\d*d\d+)([+-]\d+)?$/.exec(clean);
  if (m) return { dice: m[1], bonus: m[2] ? Number(m[2]) : 0 };
  if (/^\d+$/.test(clean)) return { dice: clean, bonus: 0 };
  return { dice: clean || "0", bonus: 0 };
}

function parseUses(usage: Raw): Uses {
  if (!usage) return { type: "atWill" };
  if (usage.type === "recharge on roll") return { type: "recharge", min: Number(usage.min_value ?? 6) };
  if (usage.type === "per day") return { type: "perDay", times: Number(usage.times ?? 1) };
  if (usage.type === "recharge after rest") return { type: "perDay", times: 1 };
  return { type: "atWill" };
}

interface Ctx {
  mods: Record<Ability, number>;
  pb: number;
}

/** Which ability (with proficiency) best explains a to-hit bonus. */
function inferToHit(bonus: number, attackType: string, ctx: Ctx) {
  const prefer: Ability[] =
    attackType === "ranged" ? ["dex", "str", "int", "wis", "cha", "con"] : ["str", "dex", "int", "wis", "cha", "con"];
  const exact = prefer.find((a) => ctx.mods[a] + ctx.pb === bonus);
  if (exact) return { ability: exact, proficient: true, flat: 0 };
  // Otherwise keep the most likely ability and record the difference as a flat bonus.
  const base = attackType === "ranged" ? "dex" : ctx.mods.str >= ctx.mods.dex ? "str" : "dex";
  return { ability: base as Ability, proficient: true, flat: bonus - ctx.mods[base] - ctx.pb };
}

function inferDc(dc: number, ctx: Ctx, preferFirst: Ability[] = []) {
  const order = [...preferFirst, "con", "int", "wis", "cha", "str", "dex"] as Ability[];
  const exact = order.find((a) => 8 + ctx.pb + ctx.mods[a] === dc);
  return exact ? { ability: exact, flat: 0 } : { ability: null, flat: dc };
}

/** Structured damage entries (taking the first option of a choice). */
function rawDamage(list: Raw[] | undefined): { dice: string; bonus: number; type: DamageType }[] {
  const out: { dice: string; bonus: number; type: DamageType }[] = [];
  for (const d of list ?? []) {
    const entry = d.choose ? d.from?.options?.[0] : d;
    const type = damageType(entry?.damage_type);
    if (!entry?.damage_dice || !type) continue;
    out.push({ ...splitDice(entry.damage_dice), type });
  }
  return out;
}

/** Fallback: "13 (2d8 + 4) Piercing damage plus 5 (2d4) Fire damage" from text. */
function textDamage(text: string): { dice: string; bonus: number; type: DamageType }[] {
  const out: { dice: string; bonus: number; type: DamageType }[] = [];
  const re = /\d+ \((\d+d\d+)(?: ?([+−-]) ?(\d+))?\) (\w+) damage/gi;
  for (const m of text.matchAll(re)) {
    const type = damageType(m[4]);
    if (!type) continue;
    const bonus = m[3] ? (m[2] === "+" ? 1 : -1) * Number(m[3]) : 0;
    out.push({ dice: m[1], bonus, type });
  }
  return out;
}

function toRolls(list: { dice: string; bonus: number; type: DamageType }[], firstAbility: Ability | null, ctx: Ctx): DamageRoll[] {
  return list.map((d, i) => {
    if (i === 0 && firstAbility && d.bonus === ctx.mods[firstAbility]) {
      return { dice: d.dice, ability: firstAbility, flat: 0, type: d.type };
    }
    return { dice: d.dice, ability: null, flat: d.bonus, type: d.type };
  });
}

function parseArea(text: string): Area | undefined {
  const m = /(\d+)-foot(?:-radius|-long)?(?:,? (\d+)-foot-wide)?(?:,? \d+-foot-(?:high|tall))? (Sphere|Cube|Cone|Line|Emanation|Cylinder)/i.exec(
    text,
  );
  if (!m) return undefined;
  const shape = m[3].toLowerCase() as (typeof AREA_SHAPES)[number];
  return { shape, size: Number(m[1]), ...(m[2] ? { width: Number(m[2]) } : {}) };
}

function parseTargets(text: string): number {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const m = /up to (\w+) (?:creatures|targets)/i.exec(text);
  if (m) return words[m[1].toLowerCase()] ?? (Number(m[1]) || 1);
  return 1;
}

function parseCondition(text: string) {
  const m = /has the (\w+) condition/i.exec(text);
  if (!m) return undefined;
  const condition = m[1].toLowerCase();
  if (!(CONDITIONS as readonly string[]).includes(condition)) return undefined;
  let durationRounds: number | null = null;
  if (/until the (?:end|start) of (?:its|the [\w’'\s]+?['’]s) next turn/i.test(text)) durationRounds = 1;
  const minutes = /for (\d+) minutes?/i.exec(text);
  if (minutes) durationRounds = Number(minutes[1]) * 10;
  const repeatSave = /repeats? the save at the end of (?:each of )?its turns?/i.test(text);
  return { condition: condition as Condition, durationRounds, repeatSave };
}

function convertAction(raw: Raw, ctx: Ctx, group: "trait" | "action" | "legendary"): StatAction {
  const name = String(raw.name);
  const text = String(raw.desc ?? "").trim();
  const uses = parseUses(raw.usage);
  const base = { name, text, uses };

  // Spellcasting (2024 stat blocks list spells with per-day uses).
  if (raw.spellcasting) {
    const sc = raw.spellcasting;
    const ability = (String(sc.ability?.index ?? "int").toLowerCase() as Ability) ?? "int";
    const toHit = /([+-]\d+) to hit with spell attacks/.exec(text);
    const profile: ActionProfile = {
      kind: "spellcasting",
      ability: (ABILITIES as readonly string[]).includes(ability) ? ability : "int",
      dc: Number(sc.dc ?? /DC (\d+)/.exec(text)?.[1] ?? 10),
      attackBonus: toHit ? Number(toHit[1]) : null,
      spells: (sc.spells ?? []).map((s: Raw) => ({
        name: String(s.name),
        level: Number(s.level ?? 0),
        uses: s.usage?.type === "per day" ? { type: "perDay", times: Number(s.usage.times ?? 1) } : { type: "atWill" },
      })),
    };
    return { ...base, profile, review: "needsReview" };
  }

  if (group === "trait") {
    return { ...base, profile: { kind: "text" }, review: KNOWN_TRAITS.has(name.replace(/ \(.*\)$/, "")) ? "auto" : "text" };
  }

  // Multiattack.
  if (name === "Multiattack") {
    const fixed: { action: string; count: number }[] = (raw.actions ?? []).map((a: Raw) => ({
      action: String(a.action_name),
      count: attackCount(a.count ?? 1),
    }));
    const ao = raw.action_options;
    let options: { action: string; count: number }[][] = [];
    if (ao?.from?.options) {
      const choices: { action: string; count: number }[][] = ao.from.options.map((o: Raw) =>
        o.option_type === "multiple"
          ? (o.items ?? []).map((i: Raw) => ({ action: String(i.action_name), count: attackCount(i.count ?? 1) }))
          : [{ action: String(o.action_name), count: attackCount(o.count ?? 1) }],
      );
      options = choices.map((c) => mergeRoutine([...fixed, ...c]));
    } else if (fixed.length) {
      options = [fixed];
    }
    if (!options.length) return { ...base, profile: { kind: "text" }, review: "text" };
    return { ...base, profile: { kind: "multiattack", options }, review: /replace|instead|uses |heads/i.test(text) ? "needsReview" : "auto" };
  }

  // Attack rolls.
  const atk = /^(Melee or Ranged|Melee|Ranged) Attack Roll: ([+−-]\d+)/i.exec(text);
  if (atk) {
    const attackType = atk[1].toLowerCase() === "melee or ranged" ? "meleeOrRanged" : (atk[1].toLowerCase() as "melee" | "ranged");
    const bonus = Number(atk[2].replace("−", "-"));
    const toHit = inferToHit(raw.attack_bonus ?? bonus, attackType, ctx);
    const hitText = text.split(/Hit:/)[1] ?? "";
    const dmg = rawDamage(raw.damage);
    const damage = toRolls(dmg.length ? dmg : textDamage(hitText), toHit.ability, ctx);
    const onHitCondition = parseCondition(hitText);
    const saveRider = /(\w+) Saving Throw: DC (\d+)/.exec(hitText);
    const profile: ActionProfile = { kind: "attack", attackType, toHit, damage };
    if (onHitCondition) profile.onHitCondition = onHitCondition;
    if (saveRider && ABILITY_BY_WORD[saveRider[1].toLowerCase()]) {
      profile.onHitSave = { save: ABILITY_BY_WORD[saveRider[1].toLowerCase()], ...inferDc(Number(saveRider[2]), ctx) };
    }
    // Anything after the damage sentence is a rider the DM may want to check.
    const rider = hitText.replace(/^[^.]*damage[^.]*\./i, "").trim();
    const understood = !rider || (onHitCondition && /escape DC/i.test(rider) && rider.length < 120);
    return { ...base, profile, review: damage.length && understood ? "auto" : "needsReview" };
  }

  // Saving-throw effects.
  const sv = /^(\w+) Saving Throw: DC (\d+)/i.exec(text);
  if (sv && ABILITY_BY_WORD[sv[1].toLowerCase()]) {
    const failure = /Failure:([\s\S]*?)(?:Success:|Failure or Success:|$)/i.exec(text)?.[1] ?? "";
    const success = /Success:([\s\S]*)$/i.exec(text)?.[1] ?? "";
    const dmg = rawDamage(raw.damage);
    const damage = toRolls(dmg.length ? dmg : textDamage(failure), null, ctx);
    const condition = parseCondition(failure);
    const area = parseArea(text);
    const breath = /breath/i.test(name);
    const profile: ActionProfile = {
      kind: "save",
      dc: { save: ABILITY_BY_WORD[sv[1].toLowerCase()], ...inferDc(Number(sv[2]), ctx, breath ? ["con"] : []) },
      damage,
      onSuccess: /half damage/i.test(success) ? "half" : "none",
      targets: area ? 1 : parseTargets(text),
    };
    if (condition) profile.condition = condition;
    if (area) profile.area = area;
    const clean = (damage.length || condition) && !/First Failure|Second Failure/i.test(text);
    return { ...base, profile, review: clean ? "auto" : "needsReview" };
  }

  return { ...base, profile: { kind: "text" }, review: "text" };
}

/** Multiattack counts are numbers, except the Hydra's "Number of Heads" (it starts with 5). */
function attackCount(raw: unknown): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return /heads/i.test(String(raw)) ? 5 : 1;
}

function mergeRoutine(list: { action: string; count: number }[]) {
  const out: { action: string; count: number }[] = [];
  for (const x of list) {
    const same = out.find((o) => o.action === x.action);
    if (same) same.count += x.count;
    else out.push({ ...x });
  }
  return out;
}

export function convertMonster(raw: Raw): ConvertedMonster {
  const abilities = {
    str: Number(raw.strength),
    dex: Number(raw.dexterity),
    con: Number(raw.constitution),
    int: Number(raw.intelligence),
    wis: Number(raw.wisdom),
    cha: Number(raw.charisma),
  };
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityMod(abilities[a])])) as Record<Ability, number>;
  const cr = Number(raw.challenge_rating ?? 0);
  const pb = Number(raw.proficiency_bonus ?? proficiencyForCr(cr));
  const ctx: Ctx = { mods, pb };

  const saveProficiencies: Ability[] = [];
  const skills: Partial<Record<(typeof SKILLS)[number], number>> = {};
  for (const p of raw.proficiencies ?? []) {
    const idx = String(p.proficiency?.index ?? "");
    if (idx.startsWith("saving-throw-")) {
      const a = idx.slice("saving-throw-".length) as Ability;
      if ((ABILITIES as readonly string[]).includes(a)) saveProficiencies.push(a);
    } else if (idx.startsWith("skill-")) {
      const skill = idx.slice("skill-".length) as (typeof SKILLS)[number];
      if (!(SKILLS as readonly string[]).includes(skill)) continue;
      const ability = SKILL_ABILITY[skill];
      skills[skill] = Math.min(2, Math.max(1, Math.round((Number(p.value) - mods[ability]) / pb)));
    }
  }

  const damageList = (list: Raw[] | undefined) => (list ?? []).map((s: Raw) => damageType(String(s).toLowerCase())).filter(Boolean) as DamageType[];
  const oddDamageNotes = [...(raw.damage_resistances ?? []), ...(raw.damage_immunities ?? []), ...(raw.damage_vulnerabilities ?? [])]
    .map(String)
    .filter((s) => !damageType(s.toLowerCase()));

  const legendaryActions = (raw.legendary_actions ?? []).map((a: Raw) => convertAction(a, ctx, "legendary"));
  const size = String(raw.size ?? "Medium").toLowerCase().split(" ")[0];

  const statBlock = StatBlock.parse({
    name: String(raw.name),
    size,
    creatureType: String(raw.type ?? "monstrosity").toLowerCase(),
    subtypes: raw.subtype ? [String(raw.subtype)] : [],
    alignment: String(raw.alignment ?? ""),
    ac: Number(raw.armor_class?.[0]?.value ?? 10),
    acNote: String(raw.armor_class?.[0]?.desc ?? raw.armor_class?.[0]?.type ?? "").replace(/^dex$/i, ""),
    hp: Number(raw.hit_points ?? 1),
    hitDice: String(raw.hit_points_roll ?? raw.hit_dice ?? ""),
    speed: {
      walk: feet(raw.speed?.walk),
      fly: feet(raw.speed?.fly),
      swim: feet(raw.speed?.swim),
      climb: feet(raw.speed?.climb),
      burrow: feet(raw.speed?.burrow),
      hover: raw.speed?.hover === true,
    },
    abilities,
    saveProficiencies,
    skills,
    vulnerabilities: damageList(raw.damage_vulnerabilities),
    resistances: damageList(raw.damage_resistances),
    immunities: damageList(raw.damage_immunities),
    damageNote: oddDamageNotes.join("; "),
    conditionImmunities: (raw.condition_immunities ?? [])
      .map((c: Raw) => String(c.index ?? c).toLowerCase())
      .filter((c: string) => (CONDITIONS as readonly string[]).includes(c)),
    senses: {
      darkvision: feet(raw.senses?.darkvision),
      blindsight: feet(raw.senses?.blindsight),
      tremorsense: feet(raw.senses?.tremorsense),
      truesight: feet(raw.senses?.truesight),
    },
    languages: String(raw.languages ?? ""),
    cr,
    proficiencyBonus: pb === proficiencyForCr(cr) ? null : pb,
    traits: (raw.special_abilities ?? []).map((a: Raw) => convertAction(a, ctx, "trait")),
    actions: (raw.actions ?? []).map((a: Raw) => convertAction(a, ctx, "action")),
    bonusActions: (raw.bonus_actions ?? []).map((a: Raw) => convertAction(a, ctx, "action")),
    reactions: (raw.reactions ?? []).map((a: Raw) => convertAction(a, ctx, "action")),
    // 2024 stat blocks almost always give 3 legendary action uses.
    legendary: legendaryActions.length ? { perRound: 3, actions: legendaryActions } : null,
  });

  return { index: String(raw.index), name: statBlock.name, statBlock };
}
