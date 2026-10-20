import type { Pt } from "./geo/polygon";
import type { OrderDraft } from "./orders/validate";
import { unitTags } from "./ruleset/derive";
import type { Ruleset } from "./ruleset/ruleset";

// The DM dragging units on the World map: which units go, split by owner
// (wild monsters move at once; a team's units ask the DM how), the record kept
// so an instant move can be undone, and the move order added for a team when
// the DM picks that instead. No database code here; src/lib/dmMoves.ts uses it.

export interface DmMoveUnit {
  id: string;
  /** Null = wild monster. */
  ownerTeamId: string | null;
}

export interface DmMovePlan {
  /** Wild monsters: moved straight away. */
  wild: string[];
  /** Each team's units, in the order the teams first appear. */
  teams: { teamId: string; unitIds: string[] }[];
}

/** Splits the units being dragged by owner. */
export function planDmMove(units: DmMoveUnit[]): DmMovePlan {
  const plan: DmMovePlan = { wild: [], teams: [] };
  for (const u of units) {
    if (!u.ownerTeamId) {
      plan.wild.push(u.id);
      continue;
    }
    let t = plan.teams.find((x) => x.teamId === u.ownerTeamId);
    if (!t) plan.teams.push((t = { teamId: u.ownerTeamId, unitIds: [] }));
    t.unitIds.push(u.id);
  }
  return plan;
}

/** Where a unit stands: its region, and the spot in it (null = the region's centre). */
export interface UnitSpot {
  unitId: string;
  regionId: string | null;
  x: number | null;
  y: number | null;
}

/** What an instant move stores in the audit log ("dm.move"): every unit's spot before and after. */
export interface DmMoveRecord {
  before: UnitSpot[];
  after: UnitSpot[];
}

export function dmMoveRecord(units: UnitSpot[], to: { regionId: string; at: Pt }): DmMoveRecord {
  return {
    before: units.map(({ unitId, regionId, x, y }) => ({ unitId, regionId, x, y })),
    after: units.map((u) => ({ unitId: u.unitId, regionId: to.regionId, x: to.at[0], y: to.at[1] })),
  };
}

const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-6);

/**
 * For an undo: the units that are no longer where the move left them
 * (something else moved them since), or that are gone. Empty = safe to undo.
 */
export function movedSince(after: UnitSpot[], current: UnitSpot[]): string[] {
  return after
    .filter((a) => {
      const c = current.find((x) => x.unitId === a.unitId);
      return !c || c.regionId !== a.regionId || !same(c.x, a.x) || !same(c.y, a.y);
    })
    .map((a) => a.unitId);
}

type Action = Ruleset["actionTypes"][number];

/** The normal move every one of these units can take, or null. */
export function normalMoveFor(rules: Ruleset, units: { creatureId: string; archetypeId: string | null }[]): Action | null {
  return (
    rules.actionTypes.find((a) => {
      if (a.handler !== "move" || (a.config.mode && a.config.mode !== "normal")) return false;
      const input = a.inputs.find((i) => i.type === "unit");
      if (!input || input.type !== "unit" || (!input.multiple && units.length > 1)) return false;
      if (!input.tag) return true;
      return units.every((u) => {
        const c = rules.creatures.find((x) => x.id === u.creatureId);
        return Boolean(c && unitTags(rules, c, u.archetypeId).includes(input.tag!));
      });
    }) ?? null
  );
}

/** A move order straight to a point, for the DM to add to a team's orders. */
export function dmMoveOrder(action: Action, unitIds: string[], to: Pt, id: string, notes = "Added by the DM."): OrderDraft {
  const inputs: Record<string, unknown> = {};
  action.inputs.forEach((input, i) => {
    if (input.type === "unit") inputs[String(i)] = input.multiple ? unitIds : unitIds[0];
    if (input.type === "path") inputs[String(i)] = [to];
  });
  return { id, kind: "free", actionTypeId: action.id, inputs, notes };
}

/** "The DM moved Bram and 2 others to C4." */
export function dmMoveNote(names: string[], where: string, asOrder: boolean): string {
  const who = names.length <= 2 ? names.join(" and ") : `${names[0]} and ${names.length - 1} others`;
  return asOrder ? `The DM added a move to your orders: ${who} to ${where}.` : `The DM moved ${who} to ${where}.`;
}
