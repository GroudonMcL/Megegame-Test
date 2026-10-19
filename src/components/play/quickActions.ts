import { unitTags } from "@/engine/ruleset/derive";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { ViewOtherUnit, ViewRegion } from "@/engine/world/teamView";
import type { WorldUnit } from "@/engine/world/types";

// Which orders can start from a thing selected on the map (QuickOrders).

type Action = Ruleset["actionTypes"][number];

export type QuickTarget = { kind: "unit"; unit: WorldUnit } | { kind: "other"; unit: ViewOtherUnit } | { kind: "region"; region: ViewRegion };


/** The actions that take this kind of thing as an input, movement first. */
export function quickActions(rules: Ruleset, target: QuickTarget): Action[] {
  const fits = (a: Action) => {
    if (target.kind === "unit") {
      const input = a.inputs.find((i) => i.type === "unit");
      if (!input || input.type !== "unit") return false;
      if (!input.tag) return true;
      const creature = rules.creatures.find((c) => c.id === target.unit.creatureId);
      return !!creature && unitTags(rules, creature, target.unit.archetypeId).includes(input.tag);
    }
    if (target.kind === "other") {
      const input = a.inputs.find((i) => i.type === "targetUnit");
      return !!input && input.type === "targetUnit" && (!input.monstersOnly || target.unit.ownerTeamId === null);
    }
    return a.inputs.some((i) => i.type === "region");
  };
  const list = rules.actionTypes.filter((a) => a.kind !== "conditional" && fits(a));
  return [...list.filter((a) => a.handler === "move"), ...list.filter((a) => a.handler !== "move")];
}
