import type { ActionProfile, Range, StatAction } from "./statblock";

// Ranges in feet for attacks and save effects, read from the action text the
// way SRD 5.2 stat blocks print them: "range 150/600 ft", "range 120 ft",
// "one creature within 30 feet", or an area that starts at the creature (a
// breath weapon's cone or line reaches as far as it is long).

const SELF_AREAS = new Set(["cone", "line", "emanation", "cube"]);

/** The range an attack or save effect's text gives it; undefined if it gives none (melee only). */
export function rangeFromText(text: string, profile: ActionProfile): Range | undefined {
  if (profile.kind === "attack") {
    if (profile.attackType === "melee") return undefined;
    const m = /\brange (\d+)(?:\s*\/\s*(\d+))?\s*(?:ft|feet)\b/i.exec(text);
    if (!m) return undefined;
    const normal = Number(m[1]);
    const long = m[2] ? Number(m[2]) : undefined;
    return long && long > normal ? { normal, long } : { normal };
  }
  if (profile.kind === "save") {
    if (profile.area && SELF_AREAS.has(profile.area.shape)) return { normal: profile.area.size };
    const within = /\bwithin (\d+) (?:ft|feet)\b/i.exec(text);
    if (within) return { normal: Number(within[1]) };
    const line = /\b(\d+)-foot-long\b/i.exec(text);
    if (line) return { normal: Number(line[1]) };
  }
  return undefined;
}

/** Can this profile have a range (ranged attacks and save effects)? */
export function takesRange(profile: ActionProfile): profile is Extract<ActionProfile, { kind: "attack" | "save" }> {
  return (profile.kind === "attack" && profile.attackType !== "melee") || profile.kind === "save";
}

/** Fills in missing ranges from the action text. Returns the new action, or the same one if nothing changed. */
export function withRangeFromText<T extends Pick<StatAction, "text" | "profile">>(action: T): T {
  const p = action.profile;
  if (!takesRange(p) || p.range) return action;
  const range = rangeFromText(action.text, p);
  return range ? { ...action, profile: { ...p, range } } : action;
}
