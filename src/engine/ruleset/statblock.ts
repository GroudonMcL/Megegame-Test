import { z } from "zod";
import { Ability, Condition, DamageType, DiceExpr, Size } from "./common";

// A full D&D 5e stat block. Each action keeps its original text (what players
// read) plus a structured "profile" (what the engine automates). Numbers that
// depend on ability scores store *which* ability they use, so a race or augment
// that changes STR also changes STR-based to-hit and damage.

export const ToHit = z.object({
  ability: Ability.nullable(),
  proficient: z.boolean(),
  /** Anything not explained by ability + proficiency (e.g. a +1 weapon). */
  flat: z.number().int(),
});

export const DamageRoll = z.object({
  dice: DiceExpr,
  ability: Ability.nullable(),
  flat: z.number().int(),
  type: DamageType,
});
export type DamageRoll = z.infer<typeof DamageRoll>;

export const SaveDc = z.object({
  save: Ability,
  /** "Con/Dex save": the target uses whichever of the two is better. */
  orSave: Ability.optional(),
  /** Which ability sets the DC (8 + proficiency + modifier + flat); null = fixed DC in `flat`. */
  ability: Ability.nullable(),
  flat: z.number().int(),
});

export const AREA_SHAPES = ["sphere", "cube", "cone", "line", "cylinder", "emanation"] as const;
export const Area = z.object({
  shape: z.enum(AREA_SHAPES),
  /** Feet: radius for sphere/cylinder/emanation, side for cube, length for cone/line. */
  size: z.number().positive(),
  /** Feet, lines only. */
  width: z.number().positive().optional(),
});
export type Area = z.infer<typeof Area>;

export const ConditionEffect = z.object({
  condition: Condition,
  /** In combat rounds; null = until removed. */
  durationRounds: z.number().int().positive().nullable(),
  /** Whether the target repeats the save at the end of each of its turns. */
  repeatSave: z.boolean(),
});

export const Uses = z.discriminatedUnion("type", [
  z.object({ type: z.literal("atWill") }),
  z.object({ type: z.literal("perDay"), times: z.number().int().positive() }),
  z.object({ type: z.literal("recharge"), min: z.number().int().min(2).max(6) }),
  z.object({ type: z.literal("perCombat"), times: z.number().int().positive() }),
]);
export type Uses = z.infer<typeof Uses>;

export const BUFF_KINDS = [
  "advantageAttacks",
  "advantageSaves",
  "disadvantageAttacks",
  "disadvantageSaves",
  "extraAttack",
  "acBonus",
  "toHitBonus",
  "damageBonus",
  "attackedWithAdvantage",
] as const;

export const ActionProfile = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attack"),
    attackType: z.enum(["melee", "ranged", "meleeOrRanged"]),
    toHit: ToHit,
    damage: z.array(DamageRoll),
    /** A rider on a hit, e.g. "the target has the Grappled condition". */
    onHitCondition: ConditionEffect.optional(),
    onHitSave: SaveDc.optional(),
  }),
  z.object({
    kind: z.literal("save"),
    dc: SaveDc,
    damage: z.array(DamageRoll),
    onSuccess: z.enum(["half", "none"]),
    condition: ConditionEffect.optional(),
    area: Area.optional(),
    /** Number of separate targets for non-area effects. */
    targets: z.number().int().positive().default(1),
  }),
  z.object({
    kind: z.literal("multiattack"),
    /** Each option is a complete attack routine; the engine picks the best one. */
    options: z.array(z.array(z.object({ action: z.string().min(1), count: z.number().int().positive() })).min(1)).min(1),
  }),
  z.object({
    kind: z.literal("heal"),
    dice: DiceExpr,
    ability: Ability.nullable(),
    flat: z.number().int(),
    targets: z.number().int().positive().default(1),
    revive: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("buff"),
    target: z.enum(["self", "ally", "enemy"]),
    effect: z.enum(BUFF_KINDS),
    amount: z.number().int().default(0),
    save: SaveDc.optional(),
    durationRounds: z.number().int().positive().nullable(),
  }),
  z.object({
    kind: z.literal("spellcasting"),
    ability: Ability,
    dc: z.number().int(),
    attackBonus: z.number().int().nullable(),
    spells: z.array(z.object({ name: z.string(), level: z.number().int().min(0).max(9), uses: Uses })),
  }),
  z.object({ kind: z.literal("text") }),
]);
export type ActionProfile = z.infer<typeof ActionProfile>;

export const REVIEW_STATES = ["auto", "needsReview", "text"] as const;

export const StatAction = z.object({
  name: z.string().min(1),
  text: z.string(),
  uses: Uses.default({ type: "atWill" }),
  /** Legendary actions only: how many of the per-round budget this costs. */
  cost: z.number().int().positive().optional(),
  profile: ActionProfile,
  /** auto = understood; needsReview = imported guess the DM should check; text = DM handles it. */
  review: z.enum(REVIEW_STATES).default("auto"),
});
export type StatAction = z.infer<typeof StatAction>;

export const Abilities = z.object({
  str: z.number().int().min(1).max(30),
  dex: z.number().int().min(1).max(30),
  con: z.number().int().min(1).max(30),
  int: z.number().int().min(1).max(30),
  wis: z.number().int().min(1).max(30),
  cha: z.number().int().min(1).max(30),
});
export type Abilities = z.infer<typeof Abilities>;

export const SKILLS = [
  "acrobatics",
  "animal-handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight-of-hand",
  "stealth",
  "survival",
] as const;
export const SKILL_ABILITY: Record<(typeof SKILLS)[number], Ability> = {
  acrobatics: "dex",
  "animal-handling": "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  "sleight-of-hand": "dex",
  stealth: "dex",
  survival: "wis",
};

export const StatBlock = z.object({
  name: z.string().min(1),
  size: Size,
  creatureType: z.string().min(1),
  subtypes: z.array(z.string()).default([]),
  alignment: z.string().default(""),
  ac: z.number().int().min(0),
  acNote: z.string().default(""),
  hp: z.number().int().positive(),
  hitDice: z.string().default(""),
  speed: z.object({
    walk: z.number().int().min(0),
    fly: z.number().int().min(0).default(0),
    swim: z.number().int().min(0).default(0),
    climb: z.number().int().min(0).default(0),
    burrow: z.number().int().min(0).default(0),
    hover: z.boolean().default(false),
  }),
  abilities: Abilities,
  /** Abilities whose saving throws add proficiency. */
  saveProficiencies: z.array(Ability).default([]),
  /** Skill → proficiency multiplier (1 = proficient, 2 = expertise). */
  skills: z.partialRecord(z.enum(SKILLS), z.number().int().min(1).max(2)).default({}),
  vulnerabilities: z.array(DamageType).default([]),
  resistances: z.array(DamageType).default([]),
  immunities: z.array(DamageType).default([]),
  /** e.g. "from nonmagical attacks" — shown with the lists above. */
  damageNote: z.string().default(""),
  conditionImmunities: z.array(Condition).default([]),
  senses: z.object({
    darkvision: z.number().int().min(0).default(0),
    blindsight: z.number().int().min(0).default(0),
    tremorsense: z.number().int().min(0).default(0),
    truesight: z.number().int().min(0).default(0),
  }),
  languages: z.string().default(""),
  cr: z.number().min(0),
  /** Null = derived from CR. */
  proficiencyBonus: z.number().int().min(0).nullable().default(null),
  traits: z.array(StatAction).default([]),
  actions: z.array(StatAction).default([]),
  bonusActions: z.array(StatAction).default([]),
  reactions: z.array(StatAction).default([]),
  legendary: z
    .object({ perRound: z.number().int().positive(), actions: z.array(StatAction) })
    .nullable()
    .default(null),
});
export type StatBlock = z.infer<typeof StatBlock>;
export type StatBlockInput = z.input<typeof StatBlock>;
