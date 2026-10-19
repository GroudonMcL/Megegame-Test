import { addTo } from "../orders/economy";
import type { Change, World } from "./types";

// Applies changes to an in-memory world. The server does the same to the
// database; this version is used by tests and to preview several orders.

export function applyChanges(world: World, changes: Change[]): World {
  const w: World = structuredClone(world);
  for (const c of changes) {
    switch (c.type) {
      case "resources": {
        const t = w.teams.find((x) => x.id === c.teamId);
        if (t) addTo(t.resources, c.delta);
        break;
      }
      case "moveUnit": {
        const u = w.units.find((x) => x.id === c.unitId);
        if (u) Object.assign(u, { regionId: c.regionId, milesUsed: c.milesUsed });
        break;
      }
      case "updateUnit": {
        const u = w.units.find((x) => x.id === c.unitId);
        if (u) Object.assign(u, c.patch);
        break;
      }
      case "createUnit":
        w.units.push(structuredClone(c.unit));
        break;
      case "updateRegion": {
        const reg = w.regions.find((x) => x.id === c.regionId);
        if (reg) Object.assign(reg, c.patch);
        break;
      }
      case "inventory": {
        const inv = (w.inventory[c.teamId] ??= {});
        inv[c.itemId] = (inv[c.itemId] ?? 0) + c.delta;
        if (inv[c.itemId] <= 0) delete inv[c.itemId];
        break;
      }
      case "detectUnits": {
        const d = (w.detections ??= {});
        d[c.teamId] = [...new Set([...(d[c.teamId] ?? []), ...c.unitIds])];
        break;
      }
      case "clearDetections":
        for (const k of Object.keys(w.detections ?? {})) w.detections![k] = w.detections![k].filter((id) => !c.unitIds.includes(id));
        break;
      case "gainRaces": {
        const t = w.teams.find((x) => x.id === c.teamId);
        if (t) t.raceIds = [...new Set([...t.raceIds, ...c.raceIds])];
        break;
      }
      case "learnRecipes": {
        const t = w.teams.find((x) => x.id === c.teamId);
        if (t) t.knownRecipeIds = [...new Set([...t.knownRecipeIds, ...c.recipeIds])];
        break;
      }
    }
  }
  return w;
}
