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
