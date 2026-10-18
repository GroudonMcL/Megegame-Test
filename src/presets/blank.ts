import { Ruleset } from "@/engine/ruleset/ruleset";

/** An empty game with only the essentials every game needs. */
export function blankPreset() {
  return Ruleset.parse({
    meta: { name: "New game" },
    resources: [{ id: "gold", name: "Gold", icon: "🪙", colour: "#d4a017" }],
    terrainTypes: [
      { id: "normal", name: "Normal" },
      { id: "difficult", name: "Difficult", costMultiplier: 2, bypassedByFlying: true, bypassedByNaturalExplorer: true },
    ],
  });
}
