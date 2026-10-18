import type { Ruleset } from "@/engine/ruleset/ruleset";
import { blankPreset } from "./blank";
import { utterdarkPreset } from "./utterdark";

export const PRESETS: { id: string; name: string; description: string; build: () => Ruleset }[] = [
  { id: "blank", name: "Blank game", description: "Start from nothing and configure everything yourself.", build: blankPreset },
  {
    id: "utterdark",
    name: "Descent into the Utterdark",
    description: "The Utterdark rules: Gold, Food and Growth, settlements, 13 buildings, SRD units and the full action list.",
    build: utterdarkPreset,
  },
];

export function buildPreset(id: string): Ruleset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset "${id}"`);
  return p.build();
}
