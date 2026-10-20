import type { Ruleset } from "@/engine/ruleset/ruleset";

// The colour a terrain type's areas are hatched in on the map: its own colour
// if the DM set one, otherwise one that suits its rules.

export function terrainColour(t: Ruleset["terrainTypes"][number] | undefined): string {
  if (!t) return "#a8a29e";
  if (t.colour) return t.colour;
  if (t.requiresMovement.includes("swim")) return "#38bdf8";
  if (t.requiresMovement.includes("climb") || t.requiresMovement.includes("burrow")) return "#94a3b8";
  if (t.requiresMovement.length) return "#c084fc";
  return t.costMultiplier > 1 ? "#d97706" : "#a3e635";
}

/** A colour as the grey of the same lightness (for terrain in glimpsed regions). */
export function greyOf(colour: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour);
  if (!m) return "#a3a3a3";
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b).toString(16).padStart(2, "0");
  return `#${v}${v}${v}`;
}

/** What a terrain type does to movement, in a sentence or two (for the map's hover note). */
export function terrainEffect(t: Ruleset["terrainTypes"][number] | undefined): string {
  if (!t) return "";
  const parts: string[] = [];
  if (t.requiresMovement.length) parts.push(`Only units with a ${t.requiresMovement.join(" or ")} speed can cross it.`);
  if (t.costMultiplier !== 1) {
    const ignore = [t.bypassedByFlying && "flying units", t.bypassedByNaturalExplorer && "natural explorers"].filter(Boolean).join(" and ");
    parts.push(`Moving through it uses ${t.costMultiplier}× the miles${ignore ? ` (not for ${ignore})` : ""}.`);
  }
  return parts.join(" ") || "No effect on movement.";
}
