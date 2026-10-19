import { z } from "zod";
import type { ResourceAmounts } from "../ruleset/common";
import { creatureCosts, unitTags } from "../ruleset/derive";
import type { Effect } from "../ruleset/effects";
import { fmtRes } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import type { TeamView, ViewRegion } from "../world/teamView";
import { ACTIVE_STATUSES, type WorldUnit } from "../world/types";
import { addTo, buildingTier, projectEconomy, unitEffects, type Economy, type EconomyLine } from "./economy";
import type { Pt } from "../geo/polygon";
import { milesPerRound, modeMultiplier, MOVE_EPSILON, type MoveMode } from "./movement";
import { parsePath, traceRoute, type RouteMap } from "./route";
import { routeMapFromView } from "./routeMap";

// Checks a team's order list as they build it, against what that team can
// see, and projects the round's economy. The same code runs in the browser
// (live feedback) and on the server (before saving), so the two always agree.
// The DM's resolution re-checks everything against the real game state.

export const ORDER_KINDS = ["numbered", "free", "conditional"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export const OrderDraft = z.object({
  id: z.uuid(),
  kind: z.enum(ORDER_KINDS),
  actionTypeId: z.string().min(1).max(64),
  /** Input values, keyed by the input's position in the action type ("0", "1"…). */
  inputs: z.record(z.string().max(3), z.unknown()).default({}),
  notes: z.string().max(5000).default(""),
});
export type OrderDraft = z.infer<typeof OrderDraft>;

export interface OrderCheck {
  id: string;
  /** Numbered slot (1…N) for numbered orders. */
  slot: number | null;
  /** For a conditional order: the order whose failure triggers it. */
  parentId: string | null;
  /** Reasons the order can't be submitted. */
  problems: string[];
  /** Things the DM will check by hand. */
  notes: string[];
  cost: ResourceAmounts;
  gain: ResourceAmounts;
  summary: string;
  /** For a move: where it starts and the line it walks (for drawing on the map). */
  route?: { unitIds: string[]; startRegion: string; endRegion: string | null; walked: Pt[]; blocked?: string };
}

export interface MovementLine {
  unitId: string;
  name: string;
  milesPerRound: number;
  /** Fraction of the round's movement used before these orders (from earlier resolution). */
  usedBefore: number;
  used: number;
  milesLeft: number;
}

export interface FreeUseLine {
  actionTypeId: string;
  name: string;
  used: number;
  /** Null = no limit. */
  available: number | null;
}

export interface OrdersCheck {
  orders: OrderCheck[];
  slotsUsed: number;
  slotsTotal: number;
  conditionalsUsed: number;
  conditionalLimit: number;
  economy: Economy;
  movement: MovementLine[];
  freeUses: FreeUseLine[];
  /** Where each of the team's units ends up and how much movement it has used, after all the orders. */
  units: Record<string, { regionId: string | null; at: Pt | null; used: number }>;
  ok: boolean;
}

/** Which ways an action of each kind can be used in the order list. */
export function allowedKinds(kind: Ruleset["actionTypes"][number]["kind"]): OrderKind[] {
  switch (kind) {
    case "numbered":
      return ["numbered", "conditional"];
    case "free":
      return ["free"];
    case "numberedAndFree":
      return ["free", "numbered", "conditional"];
    case "conditional":
      return ["conditional"];
  }
}

// ---------------------------------------------------------------------------
// Simulated state while walking down the order list.

interface SimRegion {
  ownerTeamId: string | null;
  settlementTierId: string | null;
  buildings: { buildingId: string; tier: number }[];
  /** Buildings put up or upgraded this round (can't be demolished). */
  builtThisRound: string[];
}

/** Where a unit is after a move into ground the team can't see. */
export const UNKNOWN_REGION = "?unknown";

interface Sim {
  res: ResourceAmounts;
  /** Region each unit is in after the orders so far (UNKNOWN_REGION after a move into the unknown). */
  unitRegion: Record<string, string | null>;
  /** Where each unit stands (fractions of the map). */
  unitPos: Record<string, Pt>;
  /** Fraction of each unit's movement used. */
  unitUsed: Record<string, number>;
  regions: Record<string, SimRegion>;
  inventory: Record<string, number>;
  augments: Record<string, string[]>;
  heroesRecruited: number;
  /** Units recruited by these orders, for the upkeep projection. */
  recruits: WorldUnit[];
  settlementsBuilt: Record<string, number>;
  /** "actionId", "actionId:free:unitId", "actionId:numbered:unitId"… → uses so far. */
  counts: Record<string, number>;
  freePerUnit: Record<string, number>;
  freeGranted: Record<string, number>;
  disbanded: string[];
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

function regionLabel(reg: Pick<ViewRegion, "code" | "name"> | undefined) {
  if (!reg) return "an unknown region";
  return reg.name ? `${reg.code} ${reg.name}` : reg.code;
}

/** Every effect that grants this team something: from its regions and its units. */
export function teamEffects(r: Ruleset, view: TeamView): { source: string; effect: Effect }[] {
  const out: { source: string; effect: Effect }[] = [];
  for (const reg of view.regions) {
    if (reg.ownerTeamId !== view.team.id || reg.state !== "visible") continue;
    const tier = r.settlementTiers.find((t) => t.id === reg.settlementTierId);
    for (const e of tier?.effects ?? []) out.push({ source: tier!.name, effect: e });
    for (const b of reg.buildings) {
      const bt = buildingTier(r, b);
      for (const e of bt?.tier.effects ?? []) out.push({ source: bt!.def.name, effect: e });
    }
  }
  for (const u of view.ownUnits) {
    if (!ACTIVE_STATUSES.has(u.status)) continue;
    for (const e of unitEffects(r, u)) out.push({ source: u.name || "a unit", effect: e });
  }
  return out;
}

/** Does anything in the ruleset hand out uses of this action? If so, uses are limited to what the team has. */
function grantedSomewhere(r: Ruleset, actionTypeId: string): boolean {
  const lists: Effect[][] = [
    ...r.settlementTiers.map((t) => t.effects),
    ...r.buildings.flatMap((b) => b.tiers.map((t) => t.effects)),
    ...r.archetypes.map((a) => a.effects),
    ...r.creatures.map((c) => c.effects),
    ...r.races.map((x) => x.effects),
    ...r.items.map((x) => x.effects),
  ];
  return lists.some((l) => l.some((e) => e.type === "freeActions" && e.actionTypeId === actionTypeId));
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x !== "");
  const s = asString(v);
  return s ? [s] : [];
}
function asAmounts(v: unknown): ResourceAmounts {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: ResourceAmounts = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n) && n !== 0) out[k] = n;
  return out;
}

export function validateOrders(r: Ruleset, view: TeamView, drafts: OrderDraft[]): OrdersCheck {
  const teamId = view.team.id;
  const resName = (id: string) => r.resources.find((x) => x.id === id)?.name ?? id;
  const regionById = new Map(view.regions.map((x) => [x.id, x]));
  // Built the first time a move needs it.
  let routeMap: RouteMap | undefined;
  const unitById = new Map(view.ownUnits.map((u) => [u.id, u]));
  const unitName = (id: string) => {
    const u = unitById.get(id);
    return u ? u.name || r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name || "Unit" : "an unknown unit";
  };
  const creatureOf = (u: WorldUnit) => r.creatures.find((c) => c.id === u.creatureId);
  const tagsOf = (u: WorldUnit) => {
    const c = creatureOf(u);
    return c ? unitTags(r, c, u.archetypeId) : [];
  };
  const tierIndex = (id: string | null) => r.settlementTiers.findIndex((t) => t.id === id);

  // Free-action uses the team has this round, from its buildings, settlements and units.
  const effects = teamEffects(r, view);
  const freeGranted: Record<string, number> = {};
  for (const { effect } of effects) if (effect.type === "freeActions") freeGranted[effect.actionTypeId] = (freeGranted[effect.actionTypeId] ?? 0) + effect.uses;

  const start: Sim = {
    res: { ...view.team.resources },
    unitRegion: Object.fromEntries(view.ownUnits.map((u) => [u.id, u.regionId])),
    unitPos: Object.fromEntries(
      view.ownUnits.flatMap((u): [string, Pt][] => {
        if (u.x !== null && u.y !== null) return [[u.id, [u.x, u.y]]];
        const reg = view.regions.find((x) => x.id === u.regionId);
        return reg ? [[u.id, [reg.x, reg.y]]] : [];
      }),
    ),
    unitUsed: Object.fromEntries(
      view.ownUnits.map((u) => {
        const per = milesPerRound(r, u);
        return [u.id, per > 0 ? u.milesUsed / per : 1];
      }),
    ),
    regions: Object.fromEntries(
      view.regions.map((x) => [x.id, { ownerTeamId: x.ownerTeamId, settlementTierId: x.settlementTierId, buildings: x.buildings.map((b) => ({ ...b })), builtThisRound: [] }]),
    ),
    inventory: { ...view.inventory },
    augments: Object.fromEntries(view.ownUnits.map((u) => [u.id, [...u.augmentIds]])),
    heroesRecruited: 0,
    recruits: [],
    settlementsBuilt: {},
    counts: {},
    freePerUnit: {},
    freeGranted,
    disbanded: [],
  };

  const sim = start;
  let beforeParent: Sim = clone(start);
  let parentId: string | null = null;
  let slot = 0;
  let conditionals = 0;
  const checks: OrderCheck[] = [];
  const adhoc: EconomyLine[] = [];

  for (const d of drafts) {
    const action = r.actionTypes.find((a) => a.id === d.actionTypeId);
    const check: OrderCheck = { id: d.id, slot: null, parentId: null, problems: [], notes: [], cost: {}, gain: {}, summary: action?.name ?? "Unknown action" };
    checks.push(check);
    const problem = (msg: string) => check.problems.push(msg);
    const note = (msg: string) => check.notes.push(msg);

    // Where the order sits.
    let s: Sim;
    if (d.kind === "conditional") {
      conditionals++;
      if (!parentId) problem("A conditional action must come after the action it backs up.");
      else check.parentId = parentId;
      if (conditionals > r.settings.conditionalLimit) problem(`Only ${r.settings.conditionalLimit} conditional actions per round.`);
      // It only happens if its parent fails, so check it as if the parent hadn't happened.
      s = clone(beforeParent);
    } else {
      beforeParent = clone(sim);
      parentId = d.id;
      s = sim;
      if (d.kind === "numbered") {
        slot++;
        check.slot = slot;
        if (slot > r.settings.actionSlots) problem(`You only have ${r.settings.actionSlots} numbered actions.`);
      }
    }

    if (!action) {
      problem("This action no longer exists in the rules.");
      continue;
    }
    if (!allowedKinds(action.kind).includes(d.kind)) {
      problem(`${action.name} can't be used as a ${d.kind} action.`);
    }

    // --- Inputs -------------------------------------------------------------
    const value = (type: string) => {
      const i = action.inputs.findIndex((x) => x.type === type);
      return i < 0 ? undefined : d.inputs[String(i)];
    };
    const hasInput = (type: string) => action.inputs.some((x) => x.type === type);
    const optional = new Set(["resources", "item", "recipe", "race", "archetype"]);
    action.inputs.forEach((inp, i) => {
      const v = d.inputs[String(i)];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty && !optional.has(inp.type)) problem(`Choose: ${inp.label}.`);
    });

    const unitIds = asStrings(value("unit"));
    const units = unitIds.map((id) => unitById.get(id)).filter((u): u is WorldUnit => Boolean(u));
    for (const id of unitIds) {
      const u = unitById.get(id);
      if (!u) problem("That unit isn't yours.");
      else if (!ACTIVE_STATUSES.has(u.status) || !s.unitRegion[id]) problem(`${unitName(id)} can't act (it's ${u.status}).`);
      else if (s.disbanded.includes(id)) problem(`${unitName(id)} has been disbanded by an earlier order.`);
    }
    const unitInput = action.inputs.find((x) => x.type === "unit");
    if (unitInput?.type === "unit") {
      if (!unitInput.multiple && unitIds.length > 1) problem("Pick only one unit.");
      if (unitInput.tag) for (const u of units) if (!tagsOf(u).includes(unitInput.tag)) problem(`${unitName(u.id)} isn't a ${unitInput.tag} unit.`);
    }

    // The region the order is about: the chosen region, else where its unit is.
    const regionId = asString(value("region")) ?? (units[0] ? s.unitRegion[units[0].id] : null);
    const region = regionId ? regionById.get(regionId) : undefined;
    const simRegion = regionId ? s.regions[regionId] : undefined;
    if (asString(value("region")) && !region) problem("You don't know that region.");
    if (region && region.state !== "visible" && action.handler !== "move") problem(`You can't see ${regionLabel(region)} right now.`);

    const targetInput = action.inputs.find((x) => x.type === "targetUnit");
    const targetId = asString(value("targetUnit"));
    if (targetInput?.type === "targetUnit" && targetId) {
      const target = view.otherUnits.find((u) => u.id === targetId);
      if (!target || target.dead) problem("You can't see that target.");
      else {
        if (targetInput.monstersOnly && target.ownerTeamId !== null) problem("That target isn't a monster.");
        for (const u of units) if (s.unitRegion[u.id] !== target.regionId) problem(`${unitName(u.id)} isn't in the same region as the target.`);
      }
    }

    const hostilesIn = (id: string) => view.otherUnits.some((u) => u.regionId === id && !u.dead);
    const ownUnitsIn = (id: string) => view.ownUnits.filter((u) => ACTIVE_STATUSES.has(u.status) && s.unitRegion[u.id] === id && !s.disbanded.includes(u.id));

    // --- Requirements --------------------------------------------------------
    for (const req of action.requirements) {
      switch (req.type) {
        case "unitWithTag": {
          if (units.length) {
            for (const u of units) if (!tagsOf(u).includes(req.tag)) problem(`${unitName(u.id)} isn't a ${req.tag} unit.`);
          } else {
            const pool = regionId ? ownUnitsIn(regionId) : view.ownUnits.filter((u) => ACTIVE_STATUSES.has(u.status));
            if (!pool.some((u) => tagsOf(u).includes(req.tag))) problem(`Needs a ${req.tag} unit${regionId ? ` in ${regionLabel(region)}` : ""}.`);
          }
          break;
        }
        case "unitOfCreature": {
          const name = r.creatures.find((c) => c.id === req.creatureId)?.statBlock.name ?? req.creatureId;
          const pool = units.length ? units : regionId ? ownUnitsIn(regionId) : view.ownUnits;
          if (!pool.some((u) => u.creatureId === req.creatureId)) problem(`Needs a ${name}.`);
          break;
        }
        case "buildingInRegion": {
          const name = r.buildings.find((b) => b.id === req.buildingId)?.name ?? req.buildingId;
          if (!simRegion?.buildings.some((b) => b.buildingId === req.buildingId && b.tier >= req.minTier))
            problem(`Needs a ${name}${req.minTier > 1 ? ` (tier ${req.minTier}+)` : ""} in ${regionLabel(region)}.`);
          break;
        }
        case "regionOwner": {
          if (!simRegion) break;
          const owner = simRegion.ownerTeamId;
          if (req.owner === "self" && owner !== teamId) problem(`You don't own ${regionLabel(region)}.`);
          if (req.owner === "unowned" && owner) problem(`${regionLabel(region)} is already owned.`);
          if (req.owner === "other" && (!owner || owner === teamId)) problem(`${regionLabel(region)} isn't owned by another faction.`);
          break;
        }
        case "noHostileUnits":
          if (regionId && hostilesIn(regionId)) problem(`There are hostile units in ${regionLabel(region)}.`);
          break;
        case "ownUnitInRegion":
          if (regionId && ownUnitsIn(regionId).length === 0) problem(`You need a unit in ${regionLabel(region)}.`);
          break;
        case "unitHasMovement":
          for (const u of units) if ((s.unitUsed[u.id] ?? 1) >= 1 - MOVE_EPSILON) problem(`${unitName(u.id)} has no movement left this round.`);
          break;
        case "unitStealthed":
          for (const u of units) if (u.status !== "hidden") problem(`${unitName(u.id)} must be stealthed.`);
          break;
        case "settlementPresent": {
          const at = tierIndex(simRegion?.settlementTierId ?? null);
          if (at < 0) problem(`Needs a settlement in ${regionLabel(region)}.`);
          else if (req.minTierId && at < tierIndex(req.minTierId)) {
            problem(`Needs at least a ${r.settlementTiers.find((t) => t.id === req.minTierId)?.name ?? req.minTierId} in ${regionLabel(region)}.`);
          }
          break;
        }
        case "freeSlot": {
          const tier = r.settlementTiers.find((t) => t.id === simRegion?.settlementTierId);
          if (!tier || (simRegion?.buildings.length ?? 0) >= tier.buildingSlots) problem(`${regionLabel(region)} has no free building slot.`);
          break;
        }
        case "itemInInventory": {
          const itemId = req.itemId ?? asString(value("item"));
          if (itemId && (s.inventory[itemId] ?? 0) <= 0) problem(`You don't have ${r.items.find((x) => x.id === itemId)?.name ?? itemId}.`);
          break;
        }
        case "text":
          note(`DM checks: ${req.text}`);
          break;
      }
    }

    // --- Limits and free uses ------------------------------------------------
    const isFree = d.kind === "free";
    if (d.kind !== "conditional") {
      const lim = action.limit;
      const perUnit = lim.per === "unit";
      const keys = perUnit ? (unitIds.length ? unitIds : ["-"]) : [lim.per === "building" ? `b` : "t"];
      for (const k of keys) {
        const key = `${action.id}:${action.kind === "numberedAndFree" ? d.kind : "any"}:${k}`;
        s.counts[key] = (s.counts[key] ?? 0) + 1;
        const n = s.counts[key];
        if (action.kind === "numberedAndFree" && d.kind === "numbered") {
          const extra = typeof action.config.extraNumberedUses === "number" ? action.config.extraNumberedUses : null;
          if (extra !== null && n > extra) problem(`${action.name} can only be used ${extra} more time${extra === 1 ? "" : "s"} as a numbered action${perUnit ? ` by ${unitName(k)}` : ""}.`);
          continue;
        }
        if (lim.times === null) continue;
        let max = lim.times;
        if (lim.per === "building") {
          const count = view.regions.reduce((sum, reg) => sum + (reg.ownerTeamId === teamId ? reg.buildings.filter((b) => b.buildingId === lim.buildingId).length : 0), 0);
          max = lim.times * count;
        }
        if (n > max) {
          const what = action.kind === "numberedAndFree" ? `${action.name} is free ${max}× per ${lim.per}; use a numbered action for more` : `${action.name} can be used ${max}× per ${lim.per === "team" ? "round" : lim.per}`;
          problem(`${what}${perUnit && k !== "-" ? ` (${unitName(k)})` : ""}.`);
        }
      }
    }
    if (isFree && grantedSomewhere(r, action.id)) {
      const key = `granted:${action.id}`;
      s.counts[key] = (s.counts[key] ?? 0) + 1;
      const have = s.freeGranted[action.id] ?? 0;
      if (s.counts[key] > have) problem(have === 0 ? `You have no uses of ${action.name} (they come from buildings or units).` : `You only have ${have} use${have === 1 ? "" : "s"} of ${action.name} this round.`);
    }
    if (isFree && r.settings.freeActionsPerUnit !== null) {
      for (const id of unitIds) {
        s.freePerUnit[id] = (s.freePerUnit[id] ?? 0) + 1;
        if (s.freePerUnit[id] > r.settings.freeActionsPerUnit) problem(`${unitName(id)} can only take ${r.settings.freeActionsPerUnit} free action${r.settings.freeActionsPerUnit === 1 ? "" : "s"} per round.`);
      }
    }

    // --- What the handler needs and costs -----------------------------------
    const cost: ResourceAmounts = { ...action.cost };
    const gain: ResourceAmounts = {};
    const where = regionLabel(region);
    const unitList = units.map((u) => unitName(u.id)).join(", ");
    check.summary = [action.name, unitList, hasInput("region") && region ? where : ""].filter(Boolean).join(" · ");

    switch (action.handler) {
      case "move": {
        const mode = (["normal", "forceMarch", "stealth"].includes(action.config.mode as string) ? action.config.mode : "normal") as MoveMode;
        const path = parsePath(value("path"));
        if (!units.length) break;
        const from = s.unitRegion[units[0].id];
        if (units.some((u) => s.unitRegion[u.id] !== from)) {
          problem("All the units must start in the same region.");
          break;
        }
        if (!path.length) break;
        const startAt = s.unitPos[units[0].id];
        if (!startAt || !from) {
          note("These units are somewhere you can't see after an earlier move; the DM works out this one.");
          break;
        }
        const group = units.map((u) => ({ unit: u, used: s.unitUsed[u.id] ?? 1 }));
        // After a move into ground the team doesn't know, the next one starts there (in no known region).
        const route = traceRoute(r, routeMap ??= routeMapFromView(view), startAt, from === UNKNOWN_REGION ? null : from, path, group, mode);
        if (route.blocked) problem(route.blocked);
        if (route.outOfMovement) {
          group.forEach((g, i) => {
            const per = milesPerRound(r, g.unit) * modeMultiplier(r, mode);
            const left = Math.max(0, (1 - g.used) * per);
            if (route.used[i] >= 1 - MOVE_EPSILON) problem(`${unitName(g.unit.id)} has only ${Math.floor(left)} miles of movement left; this path needs more.`);
          });
        }
        check.route = { unitIds: units.map((u) => u.id), startRegion: from, endRegion: route.endRegion, walked: route.walked, blocked: route.blocked };
        for (const [i, u] of units.entries()) {
          s.unitUsed[u.id] = route.used[i];
          s.unitRegion[u.id] = route.endRegion ?? UNKNOWN_REGION;
          s.unitPos[u.id] = route.end;
        }
        const codes = [from, ...route.entered.map((e) => e.regionId)].map((id) => (id ? (regionById.get(id)?.code ?? "?") : "?"));
        const milesText = route.miles.length ? ` (${Math.round(Math.max(...route.miles))} mi)` : "";
        check.summary = `${action.name} · ${unitList} · ${codes.filter((c, k) => k === 0 || c !== codes[k - 1]).join(" → ")}${milesText}`;
        if (route.unknown) note("Part of this route goes through ground you can't see. Your units go as far as they can; the DM checks the rest.");
        if (route.entered.some((e) => e.regionId && hostilesIn(e.regionId))) note("You're moving into a region with units you don't control. Say in the notes how you avoid combat, or it may start one.");
        break;
      }

      case "recruit": {
        const creatureId = asString(value("creature"));
        const creature = r.creatures.find((c) => c.id === creatureId);
        if (creatureId && (!creature || !creature.recruitable)) {
          problem("That unit type can't be recruited.");
          break;
        }
        if (!creature) break;
        check.summary = `${action.name} · ${creature.statBlock.name}${region ? ` · ${where}` : ""}`;
        const tier = r.settlementTiers.find((t) => t.id === simRegion?.settlementTierId);
        if (tier && tier.recruitCategories.length && !tier.recruitCategories.includes(creature.category)) {
          problem(`A ${tier.name} can't recruit ${creature.category} units.`);
        }
        const raceId = asString(value("race"));
        const races = new Set([...(view.team.baseRaceId ? [view.team.baseRaceId] : []), ...view.team.raceIds]);
        if (hasInput("race")) {
          if (raceId && !races.has(raceId)) problem("Your faction doesn't have that race.");
          if (!raceId && races.size > 0) problem("Choose: Race.");
        }
        const archetypeId = asString(value("archetype"));
        const archetype = r.archetypes.find((a) => a.id === archetypeId);
        if (archetypeId && !archetype) problem("That archetype doesn't exist.");
        if (archetype) {
          if (!archetype.categories.includes(creature.category)) problem(`${archetype.name} isn't available to ${creature.category} units.`);
          if (archetype.recruitRequiresBuildingId && !simRegion?.buildings.some((b) => b.buildingId === archetype.recruitRequiresBuildingId)) {
            problem(`${archetype.name} units can only be recruited where there's a ${r.buildings.find((b) => b.id === archetype.recruitRequiresBuildingId)?.name ?? archetype.recruitRequiresBuildingId}.`);
          }
          addTo(cost, archetype.extraCost);
        } else if (hasInput("archetype") && r.archetypes.some((a) => a.categories.includes(creature.category))) {
          problem("Choose: Archetype.");
        }
        addTo(cost, creatureCosts(creature, r).cost);
        s.recruits.push({
          id: `recruit-${d.id}`,
          ownerTeamId: teamId,
          creatureId: creature.id,
          name: `New ${creature.statBlock.name}`,
          raceId,
          archetypeId: archetype?.id ?? null,
          academyBonus: {},
          augmentIds: [],
          hp: 1,
          regionId: regionId ?? null,
          x: null,
          y: null,
          milesUsed: 0,
          status: "active",
          isLeader: false,
          usesSpent: {},
        });
        if (creature.category === "hero") {
          const heroes = view.ownUnits.filter((u) => ACTIVE_STATUSES.has(u.status) && creatureOf(u)?.category === "hero").length + s.heroesRecruited + 1;
          let limit = 0;
          let unlimited = false;
          for (const reg of Object.values(s.regions)) {
            if (reg.ownerTeamId !== teamId) continue;
            const t = r.settlementTiers.find((x) => x.id === reg.settlementTierId);
            if (!t) continue;
            if (t.heroLimit === null) unlimited ||= t.recruitCategories.includes("hero");
            else limit += t.heroLimit;
          }
          if (!unlimited && heroes > limit) problem(`Your settlements support ${limit} hero${limit === 1 ? "" : "es"}; this would be hero number ${heroes}.`);
          s.heroesRecruited++;
        }
        break;
      }

      case "constructSettlement":
      case "upgradeSettlement": {
        if (!simRegion || !region) break;
        const chosen = asString(value("settlementTier")) ?? (typeof action.config.tierId === "string" ? action.config.tierId : null);
        let tier = r.settlementTiers.find((t) => t.id === chosen);
        if (action.handler === "upgradeSettlement") {
          const next = r.settlementTiers.filter((t) => t.upgradesFrom === simRegion.settlementTierId);
          if (!simRegion.settlementTierId) {
            problem(`There's no settlement in ${where} to upgrade.`);
            break;
          }
          tier = tier && next.includes(tier) ? tier : next[0];
          if (!tier) {
            problem(`${where} can't be upgraded any further.`);
            break;
          }
        } else {
          if (!tier) tier = r.settlementTiers.find((t) => t.upgradesFrom === null);
          if (!tier) break;
          if (tier.upgradesFrom !== null) problem(`A ${tier.name} has to be upgraded from a ${r.settlementTiers.find((t) => t.id === tier!.upgradesFrom)?.name}.`);
          if (simRegion.settlementTierId) problem(`${where} already has a settlement.`);
          if (region.settleable === false) problem(`${where} can't be settled.`);
          if (tier.requiresUnclaimed && simRegion.ownerTeamId && simRegion.ownerTeamId !== teamId) problem(`${where} is claimed by someone else.`);
          if (tier.requiresNoHostiles && hostilesIn(region.id)) problem(`There are hostile units in ${where}.`);
        }
        check.summary = `${action.name} · ${tier.name} · ${where}`;
        const tierCost: ResourceAmounts = { ...tier.cost };
        for (const disc of tier.discounts) {
          if (disc.when === "ruinPresent" && region.structures.some((x) => x.kind === "ruin")) addTo(tierCost, disc.amount, -1);
        }
        for (const k of Object.keys(tierCost)) tierCost[k] = Math.max(0, tierCost[k]);
        addTo(cost, tierCost);
        // Count the team's settlements after this one is built.
        const counts: Record<string, number> = {};
        for (const reg of Object.values(s.regions)) if (reg.ownerTeamId === teamId && reg.settlementTierId) counts[reg.settlementTierId] = (counts[reg.settlementTierId] ?? 0) + 1;
        if (simRegion.settlementTierId && simRegion.ownerTeamId === teamId) counts[simRegion.settlementTierId]--;
        counts[tier.id] = (counts[tier.id] ?? 0) + 1;
        if (tier.maxPerTeam !== null && counts[tier.id] > tier.maxPerTeam) problem(`You can only have ${tier.maxPerTeam} ${tier.name}${tier.maxPerTeam === 1 ? "" : "s"}.`);
        for (const ratio of tier.ratio) {
          const need = counts[tier.id] * ratio.count;
          const have = counts[ratio.tierId] ?? 0;
          const other = r.settlementTiers.find((t) => t.id === ratio.tierId)?.name ?? ratio.tierId;
          if (have < need) problem(`For ${counts[tier.id]} ${tier.name}${counts[tier.id] === 1 ? "" : "s"} you need ${need} ${other}${need === 1 ? "" : "s"}; you have ${have}.`);
        }
        simRegion.settlementTierId = tier.id;
        simRegion.ownerTeamId = teamId;
        break;
      }

      case "constructBuilding": {
        const id = asString(value("building"));
        const def = r.buildings.find((b) => b.id === id);
        if (!def || !simRegion) break;
        check.summary = `${action.name} · ${def.name} · ${where}`;
        const already = simRegion.buildings.filter((b) => b.buildingId === def.id).length;
        if (def.maxPerRegion !== null && already >= def.maxPerRegion) problem(`${where} already has ${def.maxPerRegion === 1 ? "a" : def.maxPerRegion} ${def.name}.`);
        // The freeSlot requirement may not be listed; check anyway.
        if (!action.requirements.some((x) => x.type === "freeSlot")) {
          const tier = r.settlementTiers.find((t) => t.id === simRegion.settlementTierId);
          if (!tier || simRegion.buildings.length >= tier.buildingSlots) problem(`${where} has no free building slot.`);
        }
        addTo(cost, def.tiers[0].cost);
        simRegion.buildings.push({ buildingId: def.id, tier: 1 });
        simRegion.builtThisRound.push(def.id);
        break;
      }

      case "upgradeBuilding": {
        const id = asString(value("building"));
        const def = r.buildings.find((b) => b.id === id);
        if (!def || !simRegion) break;
        const placed = simRegion.buildings.find((b) => b.buildingId === def.id);
        if (!placed) {
          problem(`There's no ${def.name} in ${where}.`);
          break;
        }
        if (placed.tier >= def.tiers.length) {
          problem(`${def.name} is already at its highest tier.`);
          break;
        }
        check.summary = `${action.name} · ${def.name} ${placed.tier} → ${placed.tier + 1} · ${where}`;
        addTo(cost, def.tiers[placed.tier].cost);
        placed.tier++;
        simRegion.builtThisRound.push(def.id);
        break;
      }

      case "demolish": {
        const id = asString(value("building"));
        const def = r.buildings.find((b) => b.id === id);
        if (!def || !simRegion) break;
        const i = simRegion.buildings.findIndex((b) => b.buildingId === def.id);
        if (i < 0) {
          problem(`There's no ${def.name} in ${where}.`);
          break;
        }
        if (action.config.notSameRoundAsBuilt && simRegion.builtThisRound.includes(def.id)) problem(`You can't demolish the ${def.name} in the round it was built.`);
        check.summary = `${action.name} · ${def.name} · ${where}`;
        const paid: ResourceAmounts = {};
        for (let t = 0; t < simRegion.buildings[i].tier; t++) addTo(paid, def.tiers[t].cost);
        for (const [k, v] of Object.entries(paid)) gain[k] = Math.floor(v * r.settings.demolishRefund);
        simRegion.buildings.splice(i, 1);
        break;
      }

      case "heal": {
        const rates = Array.isArray(action.config.rates) ? (action.config.rates as { resourceId: string; hpPer: number }[]) : [];
        const spend = asAmounts(value("resources"));
        if (hasInput("resources") && rates.length) {
          let hp = 0;
          for (const [k, v] of Object.entries(spend)) {
            const rate = rates.find((x) => x.resourceId === k);
            if (!rate) problem(`Healing can't be paid for with ${resName(k)}.`);
            else if (v < 0) problem("Amounts can't be negative.");
            else hp += v * rate.hpPer;
          }
          addTo(cost, spend);
          if (hp === 0) note(`Healing costs ${rates.map((x) => `1 ${resName(x.resourceId)} per ${x.hpPer} HP`).join(" or ")}, unless a Healer or Temple heals for free.`);
          else check.summary += ` · ${hp} HP`;
        }
        break;
      }

      case "convert":
        addTo(gain, asAmounts(action.config.gain));
        break;

      case "market": {
        const rates = effects.flatMap(({ effect }) => (effect.type === "exchange" ? effect.rates : []));
        if (!rates.length) {
          note("You need a building with exchange rates (e.g. a Market).");
          break;
        }
        const give = asAmounts(value("resources"));
        for (const [k, v] of Object.entries(give)) {
          const rate = rates.find((x) => Object.keys(x.give).length === 1 && x.give[k]);
          if (!rate) {
            problem(`The market doesn't take ${resName(k)}.`);
            continue;
          }
          if (v % rate.give[k] !== 0) problem(`${resName(k)} is exchanged in lots of ${rate.give[k]}.`);
          const lots = Math.floor(v / rate.give[k]);
          cost[k] = (cost[k] ?? 0) + lots * rate.give[k];
          addTo(gain, rate.get, lots);
        }
        check.summary = `${action.name} · ${fmtRes(cost, r.resources)} → ${fmtRes(gain, r.resources)}`;
        break;
      }

      case "craft": {
        const mode = asString(value("choice"));
        if (mode === "Research") {
          const itemId = asString(value("item"));
          if (!itemId) problem("Choose the item to research.");
          else if ((s.inventory[itemId] ?? 0) <= 0) problem(`You don't have ${r.items.find((x) => x.id === itemId)?.name ?? itemId}.`);
          break;
        }
        const recipeId = asString(value("recipe"));
        const recipe = r.recipes.find((x) => x.id === recipeId);
        if (!recipeId) {
          problem("Choose the recipe to craft.");
          break;
        }
        if (!recipe || !(recipe.knownAtStart || view.team.knownRecipeIds.includes(recipe.id))) {
          problem("You don't know that recipe.");
          break;
        }
        for (const inp of recipe.inputs) {
          const have = s.inventory[inp.itemId] ?? 0;
          if (have < inp.qty) problem(`Not enough ${r.items.find((x) => x.id === inp.itemId)?.name ?? inp.itemId}: need ${inp.qty}, you'll have ${have}.`);
          s.inventory[inp.itemId] = have - inp.qty;
        }
        addTo(cost, recipe.resources);
        check.summary = `${action.name} · ${recipe.outputs.map((o) => `${o.qty > 1 ? `${o.qty}× ` : ""}${r.items.find((x) => x.id === o.itemId)?.name ?? o.itemId}`).join(", ")}`;
        break;
      }

      case "research": {
        const itemId = asString(value("item"));
        if (itemId && (s.inventory[itemId] ?? 0) <= 0) problem(`You don't have ${r.items.find((x) => x.id === itemId)?.name ?? itemId}.`);
        break;
      }

      case "applyAugment": {
        const itemId = asString(value("item"));
        const item = r.items.find((x) => x.id === itemId);
        const u = units[0];
        if (!itemId) {
          problem("Choose the augment.");
          break;
        }
        if (!item || !item.slotId) {
          problem("That item isn't an augment.");
          break;
        }
        if (!u) break;
        if ((s.inventory[item.id] ?? 0) <= 0) problem(`You don't have a ${item.name}.`);
        const tags = tagsOf(u);
        for (const t of item.requiresUnitTags) if (!tags.includes(t)) problem(`${item.name} needs a ${t} unit.`);
        if (item.requiresRaces.length && !item.requiresRaces.includes(u.raceId ?? "")) problem(`${item.name} can't be used by ${unitName(u.id)}'s race.`);
        const current = s.augments[u.id] ?? [];
        const limitEffect = unitEffects(r, u).find((e) => e.type === "augmentLimit");
        const max = limitEffect?.type === "augmentLimit" ? limitEffect.max : r.settings.maxAugmentsPerUnit;
        if (current.length + 1 > max) problem(`${unitName(u.id)} can carry at most ${max} augments.`);
        const slot = r.augmentSlots.find((x) => x.id === item.slotId);
        const inSlot = current.filter((id) => r.items.find((x) => x.id === id)?.slotId === item.slotId).length;
        if (slot && inSlot + 1 > slot.maxPerUnit) problem(`${unitName(u.id)} already has ${slot.maxPerUnit === 1 ? "a" : slot.maxPerUnit} ${slot.name} augment${slot.maxPerUnit === 1 ? "" : "s"}.`);
        s.augments[u.id] = [...current, item.id];
        s.inventory[item.id] = (s.inventory[item.id] ?? 0) - 1;
        check.summary = `${action.name} · ${item.name} → ${unitName(u.id)}`;
        break;
      }

      case "disband":
        for (const u of units) {
          s.disbanded.push(u.id);
          for (const id of s.augments[u.id] ?? []) s.inventory[id] = (s.inventory[id] ?? 0) + 1;
        }
        break;

      case "castSpell": {
        const spellId = asString(value("spell"));
        const spell = r.spells.find((x) => x.id === spellId);
        if (!spell) break;
        check.summary = `${action.name} · ${spell.name}${unitList ? ` · ${unitList}` : ""}`;
        if (spell.when === "combat") problem(`${spell.name} is a combat spell; it's cast automatically in combat.`);
        for (const u of units) {
          const known = unitEffects(r, u).some((e) => e.type === "spells" && e.spellIds.includes(spell.id));
          if (!known) problem(`${unitName(u.id)} can't cast ${spell.name}.`);
        }
        addTo(cost, spell.cost);
        break;
      }

      case "train":
        for (const u of units) if (Object.keys(u.academyBonus).length) note(`${unitName(u.id)} already has an Academy bonus; training replaces it.`);
        break;

      case "manual":
        note("The DM resolves this by hand.");
        break;
    }

    // Resources committed by the player (Improvise etc.) are spent too.
    if (action.handler !== "heal" && action.handler !== "market" && hasInput("resources")) addTo(cost, asAmounts(value("resources")));

    for (const [k, v] of Object.entries(cost)) if (v < 0) problem(`${resName(k)} can't be negative.`);
    for (const [k, v] of Object.entries(cost)) {
      if (v <= 0) continue;
      const have = s.res[k] ?? 0;
      if (have < v) problem(`Not enough ${resName(k)}: need ${v}, you'll have ${have}.`);
    }
    addTo(s.res, cost, -1);
    addTo(s.res, gain);
    check.cost = cost;
    check.gain = gain;

    if (d.kind !== "conditional") {
      const net: ResourceAmounts = { ...cost };
      addTo(net, gain, -1);
      if (Object.values(net).some((v) => v !== 0)) adhoc.push({ group: "orders", label: `${check.slot ? `${check.slot}. ` : ""}${check.summary}`, amounts: net });
    }
  }

  // The end of round counts what the orders build, recruit and disband, so the projection does too.
  const economy = projectEconomy(r, {
    teamId,
    resources: view.team.resources,
    regions: view.regions
      .filter((x) => x.state === "visible")
      .map((x) => ({ ...x, ownerTeamId: sim.regions[x.id].ownerTeamId, settlementTierId: sim.regions[x.id].settlementTierId, buildings: sim.regions[x.id].buildings })),
    units: [...view.ownUnits.filter((u) => !sim.disbanded.includes(u.id)), ...sim.recruits],
    adhoc,
  });

  const movement: MovementLine[] = view.ownUnits
    .filter((u) => ACTIVE_STATUSES.has(u.status) && u.regionId)
    .map((u) => {
      const per = milesPerRound(r, u);
      const usedBefore = start.unitUsed[u.id] ?? 0;
      const used = Math.min(1, sim.unitUsed[u.id] ?? usedBefore);
      return { unitId: u.id, name: unitName(u.id), milesPerRound: per, usedBefore, used, milesLeft: Math.max(0, (1 - used) * per) };
    });

  const freeUses: FreeUseLine[] = r.actionTypes
    .filter((a) => a.kind === "free" || a.kind === "numberedAndFree")
    .map((a) => {
      const used = drafts.filter((d) => d.actionTypeId === a.id && d.kind === "free").length;
      return { actionTypeId: a.id, name: a.name, used, available: grantedSomewhere(r, a.id) ? (freeGranted[a.id] ?? 0) : null };
    })
    .filter((x) => x.used > 0 || (x.available ?? 0) > 0);

  const slotsUsed = slot;
  return {
    orders: checks,
    slotsUsed,
    slotsTotal: r.settings.actionSlots,
    conditionalsUsed: conditionals,
    conditionalLimit: r.settings.conditionalLimit,
    economy,
    movement,
    freeUses,
    units: Object.fromEntries(view.ownUnits.map((u) => [u.id, { regionId: sim.unitRegion[u.id] ?? null, at: sim.unitPos[u.id] ?? null, used: sim.unitUsed[u.id] ?? 1 }])),
    ok: checks.every((c) => c.problems.length === 0),
  };
}
