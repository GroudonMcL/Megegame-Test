import type { Proposal, World } from "./types";
import { ACTIVE_STATUSES } from "../world/types";

// The resolution queue: every team's action 1, then every team's action 2,
// and so on. Free actions resolve alongside the numbered action before them;
// a backup (conditional) order sits with the order it backs up.

export interface QueueOrder {
  id: string;
  teamId: string;
  position: number;
  kind: string;
  slot: number | null;
  parentOrderId: string | null;
}

export interface QueueStep<T extends QueueOrder> {
  step: number;
  items: T[];
}

export function stepOf(order: QueueOrder, teamOrders: QueueOrder[]): number {
  if (order.kind === "numbered" && order.slot) return order.slot;
  if (order.kind === "conditional" && order.parentOrderId) {
    const parent = teamOrders.find((o) => o.id === order.parentOrderId);
    if (parent) return stepOf(parent, teamOrders);
  }
  // A free action goes with the last numbered action before it, or the first step.
  const before = teamOrders.filter((o) => o.position < order.position && o.kind === "numbered" && o.slot).sort((a, b) => b.position - a.position)[0];
  return before?.slot ?? 1;
}

export function buildQueue<T extends QueueOrder>(orders: T[], teamOrder: string[]): QueueStep<T>[] {
  const byTeam = new Map<string, T[]>();
  for (const o of orders) byTeam.set(o.teamId, [...(byTeam.get(o.teamId) ?? []), o]);
  const steps = new Map<number, T[]>();
  for (const o of orders) {
    const s = stepOf(o, byTeam.get(o.teamId)!);
    steps.set(s, [...(steps.get(s) ?? []), o]);
  }
  const rank = (teamId: string) => {
    const i = teamOrder.indexOf(teamId);
    return i < 0 ? teamOrder.length : i;
  };
  return [...steps.entries()]
    .sort(([a], [b]) => a - b)
    .map(([step, items]) => ({ step, items: items.sort((a, b) => rank(a.teamId) - rank(b.teamId) || a.position - b.position) }));
}

export interface Flag {
  kind: "sameRegion" | "targetsTeam" | "meeting";
  text: string;
  regionIds: string[];
  orderIds: string[];
}

/**
 * Interactions in one step: teams acting in the same region, orders aimed at
 * another team, and different sides ending up in the same region (a likely fight).
 * Moves in a step are treated as simultaneous.
 */
export function interactionFlags(items: { id: string; teamId: string; proposal: Proposal | null }[], world: World): Flag[] {
  const flags: Flag[] = [];
  const code = (id: string) => world.regions.find((r) => r.id === id)?.code ?? "?";
  const teamName = (id: string | null) => (id ? world.teams.find((t) => t.id === id)?.name ?? "another team" : "wild monsters");

  const touching = new Map<string, { teams: Set<string>; orders: string[] }>();
  for (const it of items) {
    for (const reg of new Set(it.proposal?.regions ?? [])) {
      const t = touching.get(reg) ?? { teams: new Set(), orders: [] };
      t.teams.add(it.teamId);
      t.orders.push(it.id);
      touching.set(reg, t);
    }
  }
  for (const [reg, t] of touching) {
    if (t.teams.size > 1) flags.push({ kind: "sameRegion", text: `${[...t.teams].map(teamName).join(" and ")} both act in ${code(reg)}`, regionIds: [reg], orderIds: t.orders });
  }

  for (const it of items) {
    const targets = [...new Set(it.proposal?.targetsTeams ?? [])].filter((t) => t !== it.teamId);
    if (targets.length) flags.push({ kind: "targetsTeam", text: `${teamName(it.teamId)} acts against ${targets.map(teamName).join(", ")}`, regionIds: it.proposal?.regions.slice(0, 1) ?? [], orderIds: [it.id] });
  }

  // Where everyone will be after this step's moves.
  const where = new Map(world.units.filter((u) => u.regionId && ACTIVE_STATUSES.has(u.status)).map((u) => [u.id, { regionId: u.regionId!, owner: u.ownerTeamId }]));
  const movers = new Map<string, string>();
  for (const it of items) {
    for (const e of it.proposal?.endsIn ?? []) {
      const u = world.units.find((x) => x.id === e.unitId);
      where.set(e.unitId, { regionId: e.regionId, owner: u ? u.ownerTeamId : it.teamId });
      movers.set(e.regionId, it.id);
    }
  }
  const sides = new Map<string, Set<string | null>>();
  for (const { regionId, owner } of where.values()) sides.set(regionId, (sides.get(regionId) ?? new Set()).add(owner));
  for (const [reg, s] of sides) {
    if (s.size < 2 || !movers.has(reg)) continue;
    const orderIds = items.filter((it) => it.proposal?.endsIn.some((e) => e.regionId === reg)).map((it) => it.id);
    flags.push({ kind: "meeting", text: `${[...s].map(teamName).join(", ")} meet in ${code(reg)}: possible combat`, regionIds: [reg], orderIds });
  }
  return flags;
}

/** Orders linked by any flag share a scene, so the DM resolves them together. */
export function scenes(flags: Flag[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const f of flags) for (const id of f.orderIds.slice(1)) parent.set(find(id), find(f.orderIds[0]));
  const out = new Map<string, number>();
  const ids = new Map<string, number>();
  for (const f of flags) {
    for (const id of f.orderIds) {
      const root = find(id);
      if (!ids.has(root)) ids.set(root, ids.size + 1);
      out.set(id, ids.get(root)!);
    }
  }
  return out;
}
