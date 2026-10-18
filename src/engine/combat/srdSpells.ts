import type { ActionProfile } from "../ruleset/statblock";

// Combat profiles for the SRD spells that monsters cast most often. A monster's
// Spellcasting action lists spells by name; the engine looks a name up in the
// game's own spell list first, then here. Spells not listed (Detect Magic,
// Fly, Invisibility…) don't matter in a fight and are skipped.
// Cantrips use their base damage; the DC and attack bonus come from the
// caster's Spellcasting action (a fixed DC of 100 means "always hits").

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
const attack = (damage: Dmg[]): ActionProfile => ({
  kind: "attack",
  attackType: "ranged",
  toHit: { ability: null, proficient: false, flat: 0 },
  damage: damage.map((d) => ({ ...d, ability: null, flat: 0 })),
});
const heal = (dice: string, targets = 1, revive = false): ActionProfile => ({ kind: "heal", dice, ability: null, flat: 0, targets, revive });
const hold = (ability: "wis" | "con" | "dex", condition: "paralyzed" | "stunned" | "frightened" | "restrained" | "unconscious" | "charmed", targets = 1): ActionProfile =>
  save(ability, [], "none", { targets, condition: { condition, durationRounds: 10, repeatSave: true } });

export const SRD_COMBAT_SPELLS: Record<string, { profile: ActionProfile; healAddsMod?: boolean }> = {
  // Damage, areas
  fireball: { profile: save("dex", [{ dice: "8d6", type: "fire" }], "half", { area: { shape: "sphere", size: 20 } }) },
  "cone of cold": { profile: save("con", [{ dice: "8d8", type: "cold" }], "half", { area: { shape: "cone", size: 60 } }) },
  "lightning bolt": { profile: save("dex", [{ dice: "8d6", type: "lightning" }], "half", { area: { shape: "line", size: 100, width: 5 } }) },
  "burning hands": { profile: save("dex", [{ dice: "3d6", type: "fire" }], "half", { area: { shape: "cone", size: 15 } }) },
  thunderwave: { profile: save("con", [{ dice: "2d8", type: "thunder" }], "half", { area: { shape: "cube", size: 15 } }) },
  shatter: { profile: save("con", [{ dice: "3d8", type: "thunder" }], "half", { area: { shape: "sphere", size: 10 } }) },
  "ice storm": { profile: save("dex", [{ dice: "2d10", type: "bludgeoning" }, { dice: "4d6", type: "cold" }], "half", { area: { shape: "cylinder", size: 20 } }) },
  "flame strike": { profile: save("dex", [{ dice: "5d6", type: "fire" }, { dice: "5d6", type: "radiant" }], "half", { area: { shape: "cylinder", size: 10 } }) },
  "spirit guardians": { profile: save("wis", [{ dice: "3d8", type: "radiant" }], "half", { area: { shape: "emanation", size: 15 } }) },
  "circle of death": { profile: save("con", [{ dice: "8d8", type: "necrotic" }], "half", { area: { shape: "sphere", size: 60 } }) },
  "meteor swarm": { profile: save("dex", [{ dice: "20d6", type: "fire" }, { dice: "20d6", type: "bludgeoning" }], "half", { area: { shape: "sphere", size: 40 } }) },
  // Damage, single or few targets
  "chain lightning": { profile: save("dex", [{ dice: "10d8", type: "lightning" }], "half", { targets: 4 }) },
  blight: { profile: save("con", [{ dice: "8d8", type: "necrotic" }], "half") },
  "inflict wounds": { profile: save("con", [{ dice: "2d10", type: "necrotic" }], "half") },
  "finger of death": { profile: save("con", [{ dice: "7d8+30", type: "necrotic" }], "half") },
  disintegrate: { profile: save("dex", [{ dice: "10d6+40", type: "force" }], "none") },
  "sacred flame": { profile: save("dex", [{ dice: "1d8", type: "radiant" }], "none") },
  "toll the dead": { profile: save("wis", [{ dice: "1d8", type: "necrotic" }], "none") },
  "fire bolt": { profile: attack([{ dice: "1d10", type: "fire" }]) },
  "ray of frost": { profile: attack([{ dice: "1d8", type: "cold" }]) },
  "eldritch blast": { profile: attack([{ dice: "1d10", type: "force" }]) },
  "guiding bolt": { profile: attack([{ dice: "4d6", type: "radiant" }]) },
  "scorching ray": { profile: attack([{ dice: "6d6", type: "fire" }]) },
  "magic missile": { profile: save("dex", [{ dice: "3d4+3", type: "force" }], "none", { dc: { save: "dex", ability: null, flat: 100 } }) },
  // Control
  "hold person": { profile: hold("wis", "paralyzed") },
  "hold monster": { profile: hold("wis", "paralyzed") },
  "dominate person": { profile: hold("wis", "charmed") },
  "dominate monster": { profile: hold("wis", "charmed") },
  fear: { profile: hold("wis", "frightened", 2) },
  web: { profile: hold("dex", "restrained", 2) },
  // Healing (the caster's spellcasting modifier is added)
  "cure wounds": { profile: heal("2d8"), healAddsMod: true },
  "healing word": { profile: heal("2d4"), healAddsMod: true },
  "mass cure wounds": { profile: heal("5d8", 6), healAddsMod: true },
  "mass healing word": { profile: heal("2d4", 6), healAddsMod: true },
  heal: { profile: heal("70") },
  revivify: { profile: heal("1", 1, true) },
};
