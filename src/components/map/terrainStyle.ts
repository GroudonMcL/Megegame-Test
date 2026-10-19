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
