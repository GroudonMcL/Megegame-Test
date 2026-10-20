import type { ActionProfile } from "../ruleset/statblock";

// Combat profiles for the SRD spells that monsters cast most often. A monster's
// Spellcasting action lists spells by name; the engine looks a name up in the
// game's own spell list first, then here. Spells not listed (Detect Magic,
// Fly, Invisibility…) don't matter in a fight and are skipped.
// Cantrips use their base damage; the DC and attack bonus come from the
// caster's Spellcasting action (a fixed DC of 100 means "always hits").
// Ranges are the spells' own; a spell that starts at the caster (a cone, a
// line) reaches as far as its area. Touch spells have none (melee only).

type Dmg = { dice: string; type: Extract<ActionProfile, { kind: "attack" }>["damage"][number]["type"] };

const save = (
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha",
  damage: Dmg[],
  onSuccess: "half" | "none",
  extra: Partial<Extract<ActionProfile, { kind: "save" }>> = {},
): ActionProfile => ({
  kind: "save",
  dc: { save: ability, ability: null, flat: 0 },
  damage: damage.map((d) => ({ ...d, ability: null, flat: 0 })),
  onSuccess,
  targets: 1,
  ...extra,
});
const attack = (damage: Dmg[], range: number): ActionProfile => ({
  kind: "attack",
  attackType: "ranged",
  toHit: { ability: null, proficient: false, flat: 0 },
  damage: damage.map((d) => ({ ...d, ability: null, flat: 0 })),
  range: { normal: range },
});
const heal = (dice: string, targets = 1, revive = false): ActionProfile => ({ kind: "heal", dice, ability: null, flat: 0, targets, revive });
const hold = (ability: "wis" | "con" | "dex", condition: "paralyzed" | "stunned" | "frightened" | "restrained" | "unconscious" | "charmed", range: number, targets = 1): ActionProfile =>
  save(ability, [], "none", { targets, condition: { condition, durationRounds: 10, repeatSave: true }, range: { normal: range } });
const ft = (normal: number) => ({ range: { normal } });

export const SRD_COMBAT_SPELLS: Record<string, { profile: ActionProfile; healAddsMod?: boolean }> = {
  // Damage, areas
  fireball: { profile: save("dex", [{ dice: "8d6", type: "fire" }], "half", { ...ft(150), area: { shape: "sphere", size: 20 } }) },
  "cone of cold": { profile: save("con", [{ dice: "8d8", type: "cold" }], "half", { ...ft(60), area: { shape: "cone", size: 60 } }) },
  "lightning bolt": { profile: save("dex", [{ dice: "8d6", type: "lightning" }], "half", { ...ft(100), area: { shape: "line", size: 100, width: 5 } }) },
  "burning hands": { profile: save("dex", [{ dice: "3d6", type: "fire" }], "half", { ...ft(15), area: { shape: "cone", size: 15 } }) },
  thunderwave: { profile: save("con", [{ dice: "2d8", type: "thunder" }], "half", { ...ft(15), area: { shape: "cube", size: 15 } }) },
  shatter: { profile: save("con", [{ dice: "3d8", type: "thunder" }], "half", { ...ft(60), area: { shape: "sphere", size: 10 } }) },
  "ice storm": { profile: save("dex", [{ dice: "2d10", type: "bludgeoning" }, { dice: "4d6", type: "cold" }], "half", { ...ft(300), area: { shape: "cylinder", size: 20 } }) },
  "flame strike": { profile: save("dex", [{ dice: "5d6", type: "fire" }, { dice: "5d6", type: "radiant" }], "half", { ...ft(60), area: { shape: "cylinder", size: 10 } }) },
  "spirit guardians": { profile: save("wis", [{ dice: "3d8", type: "radiant" }], "half", { ...ft(15), area: { shape: "emanation", size: 15 } }) },
  "circle of death": { profile: save("con", [{ dice: "8d8", type: "necrotic" }], "half", { ...ft(150), area: { shape: "sphere", size: 60 } }) },
  "meteor swarm": { profile: save("dex", [{ dice: "20d6", type: "fire" }, { dice: "20d6", type: "bludgeoning" }], "half", { ...ft(5280), area: { shape: "sphere", size: 40 } }) },
  // Damage, single or few targets
  "chain lightning": { profile: save("dex", [{ dice: "10d8", type: "lightning" }], "half", { ...ft(150), targets: 4 }) },
  blight: { profile: save("con", [{ dice: "8d8", type: "necrotic" }], "half", ft(30)) },
  "inflict wounds": { profile: save("con", [{ dice: "2d10", type: "necrotic" }], "half") },
  "finger of death": { profile: save("con", [{ dice: "7d8+30", type: "necrotic" }], "half", ft(60)) },
  disintegrate: { profile: save("dex", [{ dice: "10d6+40", type: "force" }], "none", ft(60)) },
  "sacred flame": { profile: save("dex", [{ dice: "1d8", type: "radiant" }], "none", ft(60)) },
  "toll the dead": { profile: save("wis", [{ dice: "1d8", type: "necrotic" }], "none", ft(60)) },
  "fire bolt": { profile: attack([{ dice: "1d10", type: "fire" }], 120) },
  "ray of frost": { profile: attack([{ dice: "1d8", type: "cold" }], 60) },
  "eldritch blast": { profile: attack([{ dice: "1d10", type: "force" }], 120) },
  "guiding bolt": { profile: attack([{ dice: "4d6", type: "radiant" }], 120) },
  "scorching ray": { profile: attack([{ dice: "6d6", type: "fire" }], 120) },
  "magic missile": { profile: save("dex", [{ dice: "3d4+3", type: "force" }], "none", { ...ft(120), dc: { save: "dex", ability: null, flat: 100 } }) },
  // Control
  "hold person": { profile: hold("wis", "paralyzed", 60) },
  "hold monster": { profile: hold("wis", "paralyzed", 90) },
  "dominate person": { profile: hold("wis", "charmed", 60) },
  "dominate monster": { profile: hold("wis", "charmed", 60) },
  fear: { profile: hold("wis", "frightened", 30, 2) },
  web: { profile: hold("dex", "restrained", 60, 2) },
  // Healing (the caster's spellcasting modifier is added)
  "cure wounds": { profile: heal("2d8"), healAddsMod: true },
  "healing word": { profile: heal("2d4"), healAddsMod: true },
  "mass cure wounds": { profile: heal("5d8", 6), healAddsMod: true },
  "mass healing word": { profile: heal("2d4", 6), healAddsMod: true },
  heal: { profile: heal("70") },
  revivify: { profile: heal("1", 1, true) },
};
