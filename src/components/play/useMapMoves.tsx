"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/shell/Modal";
import { useEscape } from "@/components/shell/useEscape";
import { Button } from "@/components/ui";
import type { Pt } from "@/engine/geo/polygon";
import { milesPerRound, modeMultiplier } from "@/engine/orders/movement";
import type { PathStep, RouteResult } from "@/engine/orders/route";
import { routeMapFromView } from "@/engine/orders/routeMap";
import { validateOrders, type OrderDraft, type OrdersCheck } from "@/engine/orders/validate";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { movableUnits, type TeamView } from "@/engine/world/teamView";
import { ACTIVE_STATUSES, type WorldUnit } from "@/engine/world/types";
import { findJoin, joinOrder, moveActionsFor, moveMode, moveStart, newOrder, orderUnits, previewMove, withPath, type MoveStart } from "./movePlan";
import { useOrdersDraft } from "./ordersDraft";
import { unitLabel } from "./RegionDetails";
import type { PlannedRoute, TeamMapProps } from "./TeamMap";

// Planning moves on the player's map. Drag one of your stacks to where it
// should go (press Shift on the way to add a bend), or use "Move on map" and
// tap the stops. Letting go queues a Move order (asking which kind of move if
// there's a choice), or adds the units to a move already going the same way;
// a move that can't happen queues nothing and says why. Queued moves are drawn
// on the map; click one to redraw or cancel it. Each change saves the draft.

type Action = Ruleset["actionTypes"][number];

interface Plan {
  unitIds: string[];
  start: MoveStart;
  /** Stops so far (not counting where the pointer is). */
  stops: PathStep[];
  cursor: Pt | null;
  via: "drag" | "tap";
  /** Redrawing this order's path instead of adding a move. */
  editing?: string;
}

interface Option {
  action: Action;
  route: RouteResult;
  join: OrderDraft | null;
}

const isMove = (rules: Ruleset, o: OrderDraft) => rules.actionTypes.find((a) => a.id === o.actionTypeId)?.handler === "move";
const miles = (route: RouteResult) => Math.round(route.miles.length ? Math.max(...route.miles) : 0);
/** Miles the slowest unit has left for this kind of move. */
function milesLeft(rules: Ruleset, units: WorldUnit[], start: MoveStart, action: Action) {
  return Math.floor(Math.min(...units.map((u, i) => Math.max(0, 1 - start.used[i]) * milesPerRound(rules, u) * modeMultiplier(rules, moveMode(action)))));
}

export interface MapMoves {
  /** Props for TeamMap. */
  map: Partial<TeamMapProps>;
  /** The banner, mode picker and messages, to show over the map. */
  ui: ReactNode;
  /** True while tapping out a route (map clicks add stops, not select). */
  tapping: boolean;
  /** Start tapping out a move for these units (or a new route for an order). */
  startTap: (unitIds: string[], editing?: string) => void;
  /** Can these units be given a move on the map now? */
  canMove: (unit: WorldUnit | undefined) => boolean;
  /** Units that can be dragged now (own and lent, with no move planned yet). */
  movable: Set<string>;
  /** Can the orders be changed now? */
  editable: boolean;
  check: OrdersCheck;
  cancelOrder: (id: string) => void;
}

export function useMapMoves({ view, rules, selectedRoute, onSelectRoute }: { view: TeamView; rules: Ruleset; selectedRoute: string | null; onSelectRoute: (id: string | null) => void }): MapMoves {
  const draft = useOrdersDraft();
  const { orders, editable } = draft;
  const check = useMemo(() => validateOrders(rules, view, orders), [rules, view, orders]);
  const routeMap = useMemo(() => routeMapFromView(view), [view]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState<{ plan: Plan; steps: PathStep[]; options: Option[] } | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string; key: number } | null>(null);
  const say = (ok: boolean, text: string) => setToast((t) => ({ ok, text, key: (t?.key ?? 0) + 1 }));

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.ok ? 5000 : 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // The team's own units and those lent to it.
  const controlled = movableUnits(view);
  const unitsOf = (ids: string[]) => ids.map((id) => controlled.find((u) => u.id === id)).filter((u): u is WorldUnit => Boolean(u));
  const moving = new Set(orders.filter((o) => isMove(rules, o)).flatMap((o) => orderUnits(rules, o)));
  const canMove = (u: WorldUnit | undefined): u is WorldUnit => !!u && editable && ACTIVE_STATUSES.has(u.status) && !!u.regionId && moveActionsFor(rules, [u]).length > 0;
  const movable = new Set(controlled.filter((u) => canMove(u) && !moving.has(u.id)).map((u) => u.id));

  // Where units with queued moves end up.
  const ghosts = controlled.flatMap((u) => {
    const end = check.units[u.id];
    return moving.has(u.id) && canMove(u) && end?.at && end.regionId ? [{ id: u.id, regionId: end.regionId, at: end.at }] : [];
  });

  const routes: PlannedRoute[] = check.orders.flatMap((c) =>
    c.route && c.id !== plan?.editing
      ? [{ id: c.id, points: c.route.walked, label: c.slot ? String(c.slot) : "+", bad: c.problems.length > 0, selected: c.id === selectedRoute }]
      : [],
  );

  /** Where an order's units are just before it (for redrawing its route). */
  const startBefore = (orderId: string, ids: string[]) => {
    const i = orders.findIndex((o) => o.id === orderId);
    return moveStart(validateOrders(rules, view, orders.slice(0, i)), ids);
  };

  const begin = (ids: string[], via: Plan["via"], cursor: Pt | null, editing?: string) => {
    const start = editing ? startBefore(editing, ids) : moveStart(check, ids);
    if ("error" in start) {
      say(false, start.error);
      return null;
    }
    const p: Plan = { unitIds: ids, start, stops: [], cursor, via, editing };
    setPlan(p);
    return p;
  };

  const actionsFor = (p: Plan): Action[] => {
    if (p.editing) {
      const order = orders.find((o) => o.id === p.editing);
      const action = rules.actionTypes.find((a) => a.id === order?.actionTypeId);
      return action ? [action] : [];
    }
    return moveActionsFor(rules, unitsOf(p.unitIds));
  };

  const save = async (next: OrderDraft[], done: string) => {
    const wasSubmitted = Boolean(draft.submitted);
    draft.change(next);
    const r = await draft.save({ submit: false, orders: next });
    if (!r.ok) say(false, `${done} but it couldn't be saved: ${r.text}`);
    else say(true, `${done}${wasSubmitted ? " Your orders need submitting again." : " Draft saved."}`);
  };

  const commit = (p: Plan, steps: PathStep[], o: Option) => {
    setPlan(null);
    setChoice(null);
    const where = o.route.endRegion ? (view.regions.find((r) => r.id === o.route.endRegion)?.code ?? "?") : "unknown ground";
    if (p.editing) {
      void save(
        orders.map((x) => (x.id === p.editing ? withPath(rules, x, steps) : x)),
        `Route changed: now ends in ${where} (${miles(o.route)} mi).`,
      );
    } else if (o.join) {
      const joined = o.join;
      void save(
        orders.map((x) => (x.id === joined.id ? joinOrder(rules, x, p.unitIds) : x)),
        `Joined the ${o.action.name.toLowerCase()} already going to ${where}.`,
      );
    } else {
      const order = newOrder(rules, o.action, { unitIds: p.unitIds, path: steps }, check.slotsUsed < check.slotsTotal, crypto.randomUUID());
      void save([...orders, order], `${o.action.name} queued to ${where} (${miles(o.route)} mi).`);
    }
  };

  /** Let go (or Done): queue the move, ask which kind, or say why it can't happen. */
  const finish = (p: Plan, steps: PathStep[]) => {
    setPlan(null);
    if (!steps.length) return;
    const units = unitsOf(p.unitIds);
    const slotsFree = check.slotsUsed < check.slotsTotal;
    const options = actionsFor(p).map((action): Option => {
      const route = previewMove(rules, routeMap, units, p.start, steps, action);
      return { action, route, join: p.editing ? null : findJoin(rules, view, orders, action, p.unitIds, p.start.regionId, route.endRegion) };
    });
    if (!options.length) return say(false, "These units can't move together (no kind of move suits them all).");
    const ok = options.filter((o) => !o.route.blocked && !o.route.outOfMovement && (o.join || p.editing || slotsFree || o.action.kind !== "numbered"));
    if (!ok.length) {
      const o = options[0];
      if (o.route.blocked) return say(false, `Can't move there: ${o.route.blocked}`);
      if (o.route.outOfMovement) {
        const best = Math.max(...options.map((x) => milesLeft(rules, units, p.start, x.action)));
        return say(false, `Too far: they have ${best} miles of movement left this round.`);
      }
      return say(false, `You've used all ${check.slotsTotal} numbered actions. Cancel a move, or drop these units where another move ends to join it.`);
    }
    if (ok.length === 1) return commit(p, steps, ok[0]);
    setChoice({ plan: p, steps, options: ok });
  };

  const onStackDrag = (ids: string[], at: Pt, done: boolean) => {
    const p = plan?.via === "drag" && plan.unitIds.join() === ids.join() ? { ...plan, cursor: at } : begin(ids, "drag", at);
    if (!p) return;
    if (done) finish(p, [...p.stops, at]);
    else setPlan(p);
  };

  // Shift while dragging adds a bend where the pointer is.
  const dragging = plan?.via === "drag";
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || e.repeat) return;
      setPlan((p) => (p?.cursor ? { ...p, stops: [...p.stops, p.cursor] } : p));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging]);

  // Tapping out a route: Enter = done, Backspace = undo the last stop, Escape = cancel.
  const tapping = plan?.via === "tap";
  useEscape(tapping, () => setPlan(null));
  const done = () => plan && finish(plan, plan.stops);
  useEffect(() => {
    if (!tapping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("move-plan-done")?.click();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPlan((p) => (p ? { ...p, stops: p.stops.slice(0, -1) } : p));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tapping]);

  // The live line: to the pointer while dragging, through the stops (and to the pointer) while tapping.
  let preview: TeamMapProps["preview"] = null;
  let label = "";
  if (plan) {
    const steps = plan.cursor ? [...plan.stops, plan.cursor] : plan.stops;
    const actions = actionsFor(plan);
    const units = unitsOf(plan.unitIds);
    let action = actions[0];
    if (action && steps.length) {
      let route = previewMove(rules, routeMap, units, plan.start, steps, action);
      // Too far for a normal move, but a forced march would get there: show that instead (it's what letting go will queue).
      let forced = false;
      const march = actions.find((a) => moveMode(a) === "forceMarch");
      if (route.outOfMovement && !route.blocked && march && march !== action) {
        const marched = previewMove(rules, routeMap, units, plan.start, steps, march);
        if (!marched.blocked && !marched.outOfMovement) {
          action = march;
          route = marched;
          forced = true;
        }
      }
      const left = milesLeft(rules, units, plan.start, action);
      const ok = !route.blocked && !route.outOfMovement;
      const distance = `${miles(route)} / ${left} mi${route.unknown ? " · into the unknown" : ""}`;
      const marchLeft = march && march !== action ? milesLeft(rules, units, plan.start, march) : null;
      const tooFar = marchLeft !== null ? `Too far (${left} mi left, ${marchLeft} on a forced march)` : `Too far (${left} mi left)`;
      label = route.blocked ? "Can't cross here" : route.outOfMovement ? tooFar : forced ? `Forced march · ${distance}` : distance;
      const aim = steps[steps.length - 1];
      preview = { walked: route.walked, rest: ok || !Array.isArray(aim) ? [] : [route.end, aim], ok, forced, label };
    }
  }

  const cancelOrder = (id: string) => {
    onSelectRoute(null);
    void save(
      orders.filter((o) => o.id !== id),
      "Move cancelled.",
    );
  };

  const planned = plan ? unitsOf(plan.unitIds) : [];
  const ui = (
    <>
      {tapping && plan && (
        <div className="pointer-events-auto absolute top-3 left-1/2 z-30 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-border shadow-xl" role="status">
          <div className="glass-strong absolute inset-0 -z-10 rounded-xl" aria-hidden />
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <p className="min-w-0 flex-1">
              <strong>{plan.editing ? "Redraw route" : "Move"}</strong>{" "}
              <span className="text-muted">
                {planned.map((u) => unitLabel(rules, u)).join(", ")} ·{" "}
                {plan.stops.length ? label || `${plan.stops.length} stop${plan.stops.length === 1 ? "" : "s"}` : "tap the map to add stops"}
              </span>
            </p>
            <div className="flex gap-1.5">
              <Button variant="secondary" className="px-2.5! py-1! text-xs" disabled={!plan.stops.length} onClick={() => setPlan({ ...plan, stops: plan.stops.slice(0, -1) })}>
                Undo
              </Button>
              <Button variant="secondary" className="px-2.5! py-1! text-xs" onClick={() => setPlan(null)}>
                Cancel
              </Button>
              <Button id="move-plan-done" className="px-2.5! py-1! text-xs" disabled={!plan.stops.length} onClick={done}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div
          key={toast.key}
          role={toast.ok ? "status" : "alert"}
          className={`pointer-events-auto absolute bottom-3 left-1/2 z-30 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border px-3 py-2 text-sm shadow-xl ${toast.ok ? "border-border" : "border-danger text-danger"}`}
        >
          <div className="glass-strong absolute inset-0 -z-10 rounded-xl" aria-hidden />
          {toast.text}
        </div>
      )}
      <Modal open={Boolean(choice)} onClose={() => setChoice(null)} title="Which kind of move?">
        {choice && (
          <div className="space-y-2">
            {choice.options.map((o) => {
              const left = milesLeft(rules, unitsOf(choice.plan.unitIds), choice.plan.start, o.action);
              return (
                <button
                  key={o.action.id}
                  type="button"
                  className="block w-full rounded-lg border border-border bg-raised px-3 py-2 text-left hover:border-accent"
                  onClick={() => commit(choice.plan, choice.steps, o)}
                >
                  <span className="font-medium">{o.action.name}</span>
                  <span className="ml-2 text-sm text-muted">
                    {miles(o.route)} of {left} mi
                  </span>
                  {o.action.description && <span className="mt-0.5 block text-xs text-muted">{o.action.description}</span>}
                  <span className="mt-0.5 block text-xs">{o.join ? "Joins the move already going there." : choice.plan.editing ? "" : o.action.kind === "free" ? "A free action: it only uses movement." : `Uses a numbered action (${check.slotsUsed + 1} of ${check.slotsTotal}).`}</span>
                </button>
              );
            })}
            <div className="flex justify-end pt-1">
              <Button variant="secondary" onClick={() => setChoice(null)}>
                Don&apos;t move
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );

  const map: Partial<TeamMapProps> = tapping
    ? {
        routes,
        preview,
        onPointClick: (p) => setPlan((x) => (x ? { ...x, stops: [...x.stops, p] } : x)),
        onHover: (p) => setPlan((x) => (x && (x.cursor?.[0] !== p?.[0] || x.cursor?.[1] !== p?.[1]) ? { ...x, cursor: p } : x)),
        ghosts,
      }
    : {
        routes,
        preview,
        ghosts,
        movable,
        moving,
        onStackDrag: editable ? onStackDrag : undefined,
        onRouteClick: (id) => onSelectRoute(id),
        onGhostClick: (ids) => {
          const last = [...orders].reverse().find((o) => isMove(rules, o) && orderUnits(rules, o).some((id) => ids.includes(id)));
          if (last) onSelectRoute(last.id);
        },
      };

  return {
    map,
    ui,
    tapping,
    startTap: (ids, editing) => {
      onSelectRoute(null);
      begin(ids, "tap", null, editing);
    },
    canMove,
    movable,
    editable,
    check,
    cancelOrder,
  };
}
