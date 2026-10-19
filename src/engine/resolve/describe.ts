import { fmtRes } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import type { OrderDraft } from "../orders/validate";
import type { Change, World } from "./types";

// Plain-English summaries for the DM's resolution screen.

function namers(r: Ruleset, world: World) {
  const region = (id: string) => {
    const reg = world.regions.find((x) => x.id === id);
    return reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "?";
  };
  const unit = (id: string) => {
    const u = world.units.find((x) => x.id === id);
    if (!u) return "a new unit";
    return u.name || r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name || "a unit";
  };
  return { region, unit };
}

/** "Units: Scout 1, Guard · Path: A1 → A3 · Building: Farm". */
export function describeInputs(r: Ruleset, world: World, order: OrderDraft): string[] {
  const action = r.actionTypes.find((a) => a.id === order.actionTypeId);
  if (!action) return [];
  const { region, unit } = namers(r, world);
  const out: string[] = [];
  action.inputs.forEach((inp, i) => {
    const v = order.inputs[String(i)];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
    const list = (Array.isArray(v) ? v : [v]).map(String);
    let text: string;
    switch (inp.type) {
      case "unit":
        text = list.map(unit).join(", ");
        break;
      case "region":
        text = region(list[0]);
        break;
      case "targetUnit": {
        const t = world.units.find((u) => u.id === list[0]);
        const owner = t?.ownerTeamId ? (world.teams.find((x) => x.id === t.ownerTeamId)?.name ?? "?") : "wild";
        text = t ? `${unit(t.id)} (${owner}) in ${region(t.regionId ?? "")}` : "a unit that's gone";
        break;
      }
      case "path": {
        const units = action.inputs.findIndex((x) => x.type === "unit");
        const first = units >= 0 ? ([] as string[]).concat((order.inputs[String(units)] as string[] | string) ?? [])[0] : undefined;
        const from = world.units.find((u) => u.id === first)?.regionId;
        text = [...(from ? [from] : []), ...list].map((id) => world.regions.find((x) => x.id === id)?.code ?? "?").join(" → ");
        break;
      }
      case "creature":
        text = r.creatures.find((c) => c.id === list[0])?.statBlock.name ?? list[0];
        break;
      case "race":
        text = r.races.find((x) => x.id === list[0])?.name ?? list[0];
        break;
      case "archetype":
        text = r.archetypes.find((x) => x.id === list[0])?.name ?? list[0];
        break;
      case "spell":
        text = r.spells.find((x) => x.id === list[0])?.name ?? list[0];
        break;
      case "building":
        text = r.buildings.find((x) => x.id === list[0])?.name ?? list[0];
        break;
      case "settlementTier":
        text = r.settlementTiers.find((x) => x.id === list[0])?.name ?? list[0];
        break;
      case "item":
        text = r.items.find((x) => x.id === list[0])?.name ?? list[0];
        break;
      case "recipe":
        text = r.recipes.find((x) => x.id === list[0])?.outputs.map((o) => r.items.find((i) => i.id === o.itemId)?.name ?? o.itemId).join(" + ") ?? list[0];
        break;
      case "team":
        text = world.teams.find((t) => t.id === list[0])?.name ?? "?";
        break;
      case "resources":
        text = fmtRes(v as Record<string, number>, r.resources);
        break;
      default:
        text = list.join(", ");
    }
    out.push(`${inp.label}: ${text}`);
  });
  return out;
}

export function describeChange(r: Ruleset, world: World, c: Change): string {
  const { region, unit } = namers(r, world);
  const team = (id: string) => world.teams.find((t) => t.id === id)?.name ?? "?";
  switch (c.type) {
    case "resources": {
      const parts = Object.entries(c.delta)
        .filter(([, v]) => v)
        .map(([k, v]) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} ${r.resources.find((x) => x.id === k)?.name ?? k}`);
      return `${team(c.teamId)}: ${parts.join(", ")}`;
    }
    case "moveUnit":
      return `${unit(c.unitId)} → ${region(c.regionId)}`;
    case "updateUnit": {
      const parts = Object.entries(c.patch).map(([k, v]) =>
        k === "augmentIds"
          ? `augments: ${(v as string[]).map((id) => r.items.find((x) => x.id === id)?.name ?? id).join(", ") || "none"}`
          : k === "milesUsed"
            ? "movement used up"
            : k === "usesSpent"
              ? `uses spent: ${Object.entries(v as Record<string, number>).map(([n, x]) => `${n} ×${x}`).join(", ") || "none"}`
              : k === "ownerTeamId"
                ? `now belongs to ${v ? team(v as string) : "the wild"}`
                : `${k} → ${typeof v === "object" ? JSON.stringify(v) : v}`,
      );
      return `${unit(c.unitId)}: ${parts.join(", ")}`;
    }
    case "createUnit": {
      const name = r.creatures.find((x) => x.id === c.unit.creatureId)?.statBlock.name ?? c.unit.creatureId;
      return `New ${name} for ${c.unit.ownerTeamId ? team(c.unit.ownerTeamId) : "the wild"} in ${region(c.unit.regionId ?? "")} (${c.unit.hp} HP)`;
    }
    case "updateRegion": {
      const parts: string[] = [];
      if ("ownerTeamId" in c.patch) parts.push(`owner → ${c.patch.ownerTeamId ? team(c.patch.ownerTeamId) : "nobody"}`);
      if ("settlementTierId" in c.patch) parts.push(`settlement → ${r.settlementTiers.find((t) => t.id === c.patch.settlementTierId)?.name ?? "none"}`);
      if (c.patch.buildings) parts.push(`buildings → ${c.patch.buildings.map((b) => `${r.buildings.find((x) => x.id === b.buildingId)?.name ?? b.buildingId} ${b.tier}`).join(", ") || "none"}`);
      return `${region(c.regionId)}: ${parts.join(", ")}`;
    }
    case "inventory":
      return `${team(c.teamId)}: ${c.delta > 0 ? "+" : ""}${c.delta} ${r.items.find((x) => x.id === c.itemId)?.name ?? c.itemId}`;
    case "detectUnits":
      return `${team(c.teamId)} spots ${c.unitIds.map(unit).join(", ")}`;
    case "clearDetections":
      return `${c.unitIds.map(unit).join(", ")} slip${c.unitIds.length === 1 ? "s" : ""} out of sight`;
    case "gainRaces":
      return `${team(c.teamId)} gains the ${c.raceIds.map((id) => r.races.find((x) => x.id === id)?.name ?? id).join(", ")} race`;
    case "learnRecipes":
      return `${team(c.teamId)} learns ${c.recipeIds.length} recipe${c.recipeIds.length === 1 ? "" : "s"}`;
  }
}
