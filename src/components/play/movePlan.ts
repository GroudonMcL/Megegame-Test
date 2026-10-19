import type { Pt } from "@/engine/geo/polygon";
import { type MoveMode } from "@/engine/orders/movement";
import { traceRoute, type PathStep, type RouteMap, type RouteResult } from "@/engine/orders/route";
import { allowedKinds, UNKNOWN_REGION, validateOrders, type OrderDraft, type OrdersCheck } from "@/engine/orders/validate";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import type { WorldUnit } from "@/engine/world/types";
import { quickActions } from "./quickActions";

// Planning moves on the map (dragging a stack, or tapping stops): which move
// actions fit, where the units start, what the route would do, and the order
// it becomes. Only a preview: the Orders window and the server check it again.

type Action = Ruleset["actionTypes"][number];

/** The move actions every one of these units can take (normal move first). */
export function moveActionsFor(rules: Ruleset, units: WorldUnit[]): Action[] {
  if (!units.length) return [];
  const lists = units.map((unit) => quickActions(rules, { kind: "unit", unit }).filter((a) => a.handler === "move"));
  return lists[0].filter((a) => lists.every((l) => l.includes(a)));
}

export function moveMode(action: Action): MoveMode {
  const m = action.config.mode;
  return m === "forceMarch" || m === "stealth" ? m : "normal";
}

/**
 * A new order for an action, with its inputs filled in where it takes them:
 * the units, a region, a target unit, a path. A numbered action takes a
 * numbered slot if one is free.
 */
export function newOrder(
  rules: Ruleset,
  action: Action,
  fill: { unitIds?: string[]; regionId?: string; targetId?: string; path?: PathStep[] },
  slotsFree: boolean,
  id: string,
): OrderDraft {
  const kinds = allowedKinds(action.kind);
  const inputs: Record<string, unknown> = {};
  action.inputs.forEach((input, i) => {
    if (input.type === "unit" && fill.unitIds?.length) inputs[String(i)] = input.multiple ? fill.unitIds : fill.unitIds[0];
    if (input.type === "region" && fill.regionId) inputs[String(i)] = fill.regionId;
    if (input.type === "targetUnit" && fill.targetId) inputs[String(i)] = fill.targetId;
    if (input.type === "path" && fill.path) inputs[String(i)] = fill.path;
  });
  return { id, kind: kinds.includes("numbered") && slotsFree ? "numbered" : kinds[0], actionTypeId: action.id, inputs, notes: "" };
}

export interface MoveStart {
  at: Pt;
  regionId: string;
  /** Fraction of the round's movement each unit has used so far (same order as the units). */
  used: number[];
}

/** Where these units would start a new move: where they are after the orders already queued. */
export function moveStart(check: OrdersCheck, unitIds: string[]): MoveStart | { error: string } {
  const spots = unitIds.map((id) => check.units[id]);
  if (!spots.length || spots.some((s) => !s)) return { error: "Those units can't move." };
  const regionId = spots[0].regionId;
  if (spots.some((s) => s.regionId !== regionId)) return { error: "Those units end up in different places; move them one at a time." };
  if (!regionId || regionId === UNKNOWN_REGION || !spots[0].at) return { error: "Those units' earlier move goes somewhere you can't see, so the map can't plan from there. Add the next move in the Orders window." };
  return { at: spots[0].at, regionId, used: spots.map((s) => s.used) };
}

/** What a move would do, for the preview line. */
export function previewMove(rules: Ruleset, map: RouteMap, units: WorldUnit[], start: MoveStart, steps: PathStep[], action: Action): RouteResult {
  return traceRoute(
    rules,
    map,
    start.at,
    start.regionId,
    steps,
    units.map((unit, i) => ({ unit, used: start.used[i] })),
    moveMode(action),
  );
}

const unitInput = (action: Action) => action.inputs.findIndex((x) => x.type === "unit");

/** The unit IDs an order acts with. */
export function orderUnits(rules: Ruleset, order: OrderDraft): string[] {
  const action = rules.actionTypes.find((a) => a.id === order.actionTypeId);
  if (!action) return [];
  const v = order.inputs[String(unitInput(action))];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
}

/**
 * An existing move these units can join instead of using another action: the
 * same kind of move, from the region they're in to the region they're going
 * to. Only for units with no moves of their own yet (so they are where that
 * move starts when it happens).
 */
export function findJoin(rules: Ruleset, view: TeamView, orders: OrderDraft[], action: Action, unitIds: string[], from: string, to: string | null): OrderDraft | null {
  if (!to) return null;
  const input = action.inputs[unitInput(action)];
  if (!input || input.type !== "unit" || !input.multiple) return null;
  const moving = new Set(orders.filter((o) => rules.actionTypes.find((a) => a.id === o.actionTypeId)?.handler === "move").flatMap((o) => orderUnits(rules, o)));
  if (unitIds.some((id) => moving.has(id))) return null;
  const checks = new Map(validateOrders(rules, view, orders).orders.map((c) => [c.id, c]));
  return (
    orders.find((o) => {
      const route = checks.get(o.id)?.route;
      return o.actionTypeId === action.id && route && !route.blocked && route.startRegion === from && route.endRegion === to;
    }) ?? null
  );
}

/** The order with these units added to it. */
export function joinOrder(rules: Ruleset, order: OrderDraft, unitIds: string[]): OrderDraft {
  const action = rules.actionTypes.find((a) => a.id === order.actionTypeId);
  if (!action) return order;
  const ids = [...new Set([...orderUnits(rules, order), ...unitIds])];
  return { ...order, inputs: { ...order.inputs, [String(unitInput(action))]: ids } };
}

/** The path of a move order (the points and links it was given). */
export function orderPath(rules: Ruleset, order: OrderDraft): unknown {
  const action = rules.actionTypes.find((a) => a.id === order.actionTypeId);
  const i = action?.inputs.findIndex((x) => x.type === "path") ?? -1;
  return i < 0 ? undefined : order.inputs[String(i)];
}

/** The order with a new path. */
export function withPath(rules: Ruleset, order: OrderDraft, path: PathStep[]): OrderDraft {
  const action = rules.actionTypes.find((a) => a.id === order.actionTypeId);
  const i = action?.inputs.findIndex((x) => x.type === "path") ?? -1;
  return i < 0 ? order : { ...order, inputs: { ...order.inputs, [String(i)]: path } };
}
