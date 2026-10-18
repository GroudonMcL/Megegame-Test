import { createRng } from "../rng";
import { rollDice, describeRoll } from "../dice";
import type { Ability, ResourceAmounts } from "../ruleset/common";
import { deriveStats, unitBonuses } from "../ruleset/derive";
import { fmtRes } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import { addTo, buildingTier, unitEffects } from "../orders/economy";
import { findConnection, milesPerRound, stepCost, type MoveMode } from "../orders/movement";
import { validateOrders, type OrderDraft } from "../orders/validate";
import type { TeamView } from "../world/teamView";
import { ACTIVE_STATUSES, ON_MAP_STATUSES, type WorldUnit } from "../world/types";
import { defendersOf, fightChanges, fightSummary, retreatRegion, runFight, sideFor, wildIn } from "../combat/fight";
import { summariseOdds } from "../combat/simulate";
import type { CombatOdds, CombatSideInput } from "../combat/types";
import { rollOnTable, type Modifier } from "./rollTable";
import type { Proposal, World } from "./types";

// Pre-resolves one order against the real game state: checks it again, rolls
// what needs rolling, and lists the state changes and drafted outcome text for
// the DM to accept, edit or reject. Nothing here touches the database.

/** The team's view with nothing hidden, for checking orders against the truth. */
export function fullView(world: World, teamId: string, round: number): TeamView {
  const team = world.teams.find((t) => t.id === teamId);
  if (!team) throw new Error("Unknown team");
  return {
    team: { ...team, secretObjectives: "" },
    teams: world.teams.filter((t) => t.id !== teamId).map(({ id, name, colour, isNpc }) => ({ id, name, colour, isNpc })),
    regions: world.regions.map((r) => ({
      id: r.id,
      code: r.code,
      x: r.x,
      y: r.y,
      state: "visible" as const,
      name: r.name,
      description: r.description,
      settleable: r.settleable,
      ownerTeamId: r.ownerTeamId,
      settlementTierId: r.settlementTierId,
      buildings: r.buildings,
      structures: r.structures.map(({ kind, name, description, searched }) => ({ kind, name, description, searched })),
      deposits: r.deposits.map(({ id, name, note, production }) => ({ id, name, note, production })),
      features: r.features,
      lastSeenRound: null,
    })),
    connections: world.connections,
    ownUnits: world.units.filter((u) => u.ownerTeamId === teamId),
    otherUnits: world.units
      .filter((u) => u.ownerTeamId !== teamId && u.regionId && ON_MAP_STATUSES.has(u.status))
      .map((u) => ({ id: u.id, creatureId: u.creatureId, creatureName: u.creatureId, ownerTeamId: u.ownerTeamId, regionId: u.regionId!, dead: u.status === "dead" })),
    inventory: world.inventory[teamId] ?? {},
    round,
  };
}

export interface ResolveInput {
  ruleset: Ruleset;
  world: World;
  teamId: string;
  order: OrderDraft;
  round: number;
  /** Changing the seed re-rolls everything. */
  seed: string;
  /** The DM's choices for fights this order causes. */
  combat?: CombatOptions;
}

export interface CombatOptions {
  /** sideId (team ID or "wild") → enemy unit that side concentrates on. */
  priority?: Record<string, string>;
  /** Don't simulate: the DM resolves the fight by hand. */
  byHand?: boolean;
  /** unitId → the DM's own result for that unit, replacing the simulated one. */
  overrides?: Record<string, { hp?: number; outcome?: "standing" | "dead" | "retreated" }>;
}

function newUnitId() {
  return globalThis.crypto.randomUUID();
}

export function maxHpOf(r: Ruleset, u: WorldUnit): number {
  const c = r.creatures.find((x) => x.id === u.creatureId);
  return c ? deriveStats(c.statBlock, unitBonuses(r, u)).maxHp.total : u.hp;
}

export function resolveOrder(input: ResolveInput): Proposal {
  const { ruleset: r, world, teamId, order } = input;
  const rng = createRng(input.seed);
  const team = world.teams.find((t) => t.id === teamId)!;
  const action = r.actionTypes.find((a) => a.id === order.actionTypeId);
  const p: Proposal = { status: "ready", problems: [], notes: [], rolls: [], changes: [], text: "", regions: [], targetsTeams: [], endsIn: [] };
  if (!action) {
    p.status = "invalid";
    p.problems.push("This action no longer exists in the rules.");
    p.text = "This order couldn't be carried out.";
    return p;
  }

  // Check it again against the real state. A backup order is checked as a normal one.
  const draft: OrderDraft = { ...order, kind: order.kind === "conditional" ? (action.kind === "free" ? "free" : "numbered") : order.kind };
  const view = fullView(world, teamId, input.round);
  const check = validateOrders(r, view, [draft]).orders[0];

  const value = (type: string) => {
    const i = action.inputs.findIndex((x) => x.type === type);
    return i < 0 ? undefined : order.inputs[String(i)];
  };
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : str(v) ? [v as string] : []);
  const unitById = new Map(world.units.map((u) => [u.id, u]));
  const regionById = new Map(world.regions.map((x) => [x.id, x]));
  const units = strs(value("unit"))
    .map((id) => unitById.get(id))
    .filter((u): u is WorldUnit => Boolean(u && u.ownerTeamId === teamId));
  const name = (u: WorldUnit) => u.name || r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name || "a unit";
  const unitList = units.map(name).join(", ");
  const regionName = (id: string | null | undefined) => {
    const reg = id ? regionById.get(id) : undefined;
    return reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "an unknown region";
  };
  const regionId = str(value("region")) ?? units[0]?.regionId ?? null;
  const region = regionId ? regionById.get(regionId) : undefined;
  if (regionId) p.regions.push(regionId);
  if (str(value("region")) && region?.ownerTeamId && region.ownerTeamId !== teamId) p.targetsTeams.push(region.ownerTeamId);

  if (check.problems.length) {
    p.status = "invalid";
    p.problems.push(...check.problems);
    p.text = `${action.name} couldn't be carried out: ${check.problems[0]}`;
    return p;
  }
  p.notes.push(...check.notes);

  const net: ResourceAmounts = {};
  addTo(net, check.gain);
  addTo(net, check.cost, -1);
  const spend = () => {
    if (Object.values(net).some((v) => v !== 0)) p.changes.push({ type: "resources", teamId, delta: { ...net } });
  };
  const review = (note?: string) => {
    if (p.status === "ready") p.status = "needsReview";
    if (note) p.notes.push(note);
  };
  const byHand = (note: string) => {
    p.status = "needsDm";
    p.notes.push(note);
  };
  const lines: string[] = [];

  /** Simulates a fight (or leaves it to the DM) and adds its changes and text. */
  const fight = (where: string, sides: CombatSideInput[], extra: { focus?: string; capture?: string; reveal?: string[] } = {}) => {
    const enemyTeams = sides.filter((x) => x.id !== teamId).map((x) => x.teamId);
    if (input.combat?.byHand) {
      byHand(`Fight in ${regionName(where)} against ${sides.filter((x) => x.id !== teamId).map((x) => x.name).join(" and ")}: you chose to resolve it by hand. Change HP and statuses on the World map.`);
      return;
    }
    const priority = { ...(extra.focus ? { [teamId]: extra.focus } : {}), ...(input.combat?.priority ?? {}) };
    const res = runFight(r, world, where, sides, `${input.seed}:fight:${(p.combats ?? []).length}`, {
      priority,
      capture: extra.capture ? { sideId: teamId, targetId: extra.capture } : undefined,
    });
    for (const u of res.units) {
      const o = input.combat?.overrides?.[u.unitId];
      if (!o) continue;
      if (o.outcome) u.outcome = o.outcome;
      if (typeof o.hp === "number") u.hp = Math.max(0, Math.min(u.maxHp, Math.round(o.hp)));
      if (u.outcome === "dead") u.hp = 0;
      else if (u.hp === 0) u.hp = 1;
      const unit = world.units.find((x) => x.id === u.unitId);
      u.retreatTo = u.outcome === "retreated" && unit ? (u.retreatTo ?? retreatRegion(world, unit, where)) : null;
      res.log.push({ round: res.rounds, kind: "info", text: `The DM set ${u.label} to ${u.outcome === "standing" ? "standing" : u.outcome}${u.outcome === "dead" ? "" : ` with ${u.hp}/${u.maxHp} HP`}.` });
    }
    (p.combats ??= []).push(res);
    p.changes.push(...fightChanges(r, world, res, { reveal: extra.reveal }));
    lines.push(fightSummary(world, res, teamId));
    for (const other of enemyTeams) {
      if (!other) continue;
      (p.reports ??= []).push({ teamId: other, text: `Your units were attacked by ${team.name}. ${fightSummary(world, res, other)}` });
    }
    review(`A fight was simulated${res.warnings.length ? `; some abilities aren't automated (see the fight log)` : ""}. Check the log, re-roll it, or resolve it by hand.`);
  };

  switch (action.handler) {
    case "move": {
      const mode = (["normal", "forceMarch", "stealth"].includes(action.config.mode as string) ? action.config.mode : "normal") as MoveMode;
      const path = strs(value("path"));
      const from = units[0]?.regionId;
      if (!from || !path.length) break;
      const group = units.map((u) => ({ unit: u, used: milesPerRound(r, u) > 0 ? u.milesUsed / milesPerRound(r, u) : 1 }));
      const used = group.map((g) => g.used);
      let at = from;
      let prev: string | null = null;
      // Monsters attack units that walk in (unless they creep past by stealth): the move stops there.
      let fightAt: string | null = null;
      for (const next of path) {
        const c = findConnection(world.connections, at, next)!;
        const step = stepCost(r, c, group, mode);
        if ("blocked" in step) break;
        step.fractions.forEach((f, i) => (used[i] += f));
        prev = at;
        at = next;
        if (mode !== "stealth" && wildIn(world, next).length) {
          fightAt = next;
          break;
        }
      }
      const walked = path.slice(0, path.indexOf(at) + 1);
      p.regions.push(...walked);
      units.forEach((u, i) => {
        p.changes.push({ type: "moveUnit", unitId: u.id, regionId: at, milesUsed: fightAt ? milesPerRound(r, u) : Math.min(1, used[i]) * milesPerRound(r, u) });
        p.endsIn.push({ unitId: u.id, regionId: at });
      });
      const route = [from, ...walked].map((id) => regionById.get(id)?.code ?? "?").join(" → ");
      lines.push(`${unitList} ${mode === "forceMarch" ? "force-marched" : mode === "stealth" ? "crept" : "moved"} ${route}${fightAt && walked.length < path.length ? " and stopped there" : ""}.`);
      for (const id of walked) {
        const others = world.units.filter((u) => u.regionId === id && u.ownerTeamId !== teamId && ACTIVE_STATUSES.has(u.status) && !(id === fightAt && u.ownerTeamId === null && u.status === "active"));
        if (others.length) {
          const who = [...new Set(others.map((u) => (u.ownerTeamId ? world.teams.find((t) => t.id === u.ownerTeamId)?.name : "wild monsters")))].join(", ");
          const hidden = others.some((u) => u.status === "hidden");
          review(`${regionName(id)} has units of ${who}${hidden ? " (some hidden)" : ""}. Teams only fight through an Attack order${hidden ? "; hidden units may ambush (stealth comes in Phase 7)" : ""}.`);
          for (const u of others) if (u.ownerTeamId) p.targetsTeams.push(u.ownerTeamId);
        }
      }
      if (fightAt) {
        const movers = units.map((u) => ({ ...u, regionId: fightAt }));
        fight(fightAt, [
          sideFor(world, teamId, movers, {
            forceMarching: mode === "forceMarch" ? units.map((u) => u.id) : [],
            retreatTo: Object.fromEntries(units.map((u) => [u.id, retreatRegion(world, u, fightAt!, prev)])),
          }),
          sideFor(world, null, wildIn(world, fightAt)),
        ]);
      }
      if (mode === "stealth") review("Stealth checks come in Phase 7. For now, decide whether the units stay hidden.");
      if (mode === "forceMarch") p.notes.push("Force-marched units fight at disadvantage this round.");
      break;
    }

    case "attack":
    case "capture": {
      const target = world.units.find((u) => u.id === str(value("targetUnit")));
      if (!target?.regionId || !units.length) break;
      const where = target.regionId;
      if (target.ownerTeamId) p.targetsTeams.push(target.ownerTeamId);
      p.regions.push(where);
      const defenders = target.ownerTeamId === null ? wildIn(world, where).concat(target.status === "active" ? [] : [target]) : defendersOf(world, target, where);
      const surprising = units.every((u) => u.status === "hidden");
      const targetName = r.creatures.find((c) => c.id === target.creatureId)?.statBlock.name ?? "a unit";
      lines.push(`${unitList} ${action.handler === "capture" ? "tried to capture" : "attacked"} the ${targetName} ${target.ownerTeamId ? `of ${world.teams.find((t) => t.id === target.ownerTeamId)?.name ?? "another faction"}` : "(wild)"} in ${regionName(where)}${surprising ? " by surprise" : ""}.`);
      fight(
        where,
        [
          sideFor(world, teamId, units, { surprising, retreatTo: Object.fromEntries(units.map((u) => [u.id, retreatRegion(world, u, where)])) }),
          sideFor(world, target.ownerTeamId, defenders, {
            retreatTo: Object.fromEntries(defenders.map((u) => [u.id, target.ownerTeamId ? retreatRegion(world, u, where) : null])),
          }),
        ],
        { focus: target.id, capture: action.handler === "capture" ? target.id : undefined, reveal: units.map((u) => u.id) },
      );
      break;
    }

    case "recruit": {
      const creature = r.creatures.find((c) => c.id === str(value("creature")));
      if (!creature || !region) break;
      const archetypeId = str(value("archetype"));
      const raceId = str(value("race"));
      const academy = region.buildings.find((b) => buildingTier(r, b)?.tier.effects.some((e) => e.type === "abilityChoiceBonus"));
      const bonus = academy ? buildingTier(r, academy)!.tier.effects.find((e) => e.type === "abilityChoiceBonus") : undefined;
      const academyBonus: Record<string, number> = academy?.choice && bonus?.type === "abilityChoiceBonus" ? { [academy.choice]: bonus.amount } : {};
      const draftUnit: WorldUnit = {
        id: newUnitId(),
        ownerTeamId: teamId,
        creatureId: creature.id,
        name: "",
        raceId,
        archetypeId,
        academyBonus,
        augmentIds: [],
        hp: 0,
        regionId: region.id,
        milesUsed: 0,
        status: "active",
        isLeader: false,
          usesSpent: {},
      };
      draftUnit.hp = maxHpOf(r, draftUnit);
      // A unit recruited this round can't move until the next one.
      draftUnit.milesUsed = milesPerRound(r, draftUnit);
      p.changes.push({ type: "createUnit", unit: draftUnit });
      p.endsIn.push({ unitId: draftUnit.id, regionId: region.id });
      const archetype = r.archetypes.find((a) => a.id === archetypeId);
      lines.push(`A new ${creature.statBlock.name}${archetype ? ` (${archetype.name})` : ""} joined you in ${regionName(region.id)}.`);
      if (academy && !academy.choice) review("This region's Academy has no ability chosen, so the new unit gets no Academy bonus.");
      break;
    }

    case "constructSettlement":
    case "upgradeSettlement": {
      if (!region) break;
      const chosen = str(value("settlementTier")) ?? (typeof action.config.tierId === "string" ? action.config.tierId : null);
      const tier =
        action.handler === "upgradeSettlement"
          ? r.settlementTiers.find((t) => t.id === chosen && t.upgradesFrom === region.settlementTierId) ?? r.settlementTiers.find((t) => t.upgradesFrom === region.settlementTierId)
          : r.settlementTiers.find((t) => t.id === chosen) ?? r.settlementTiers.find((t) => t.upgradesFrom === null);
      if (!tier) break;
      p.changes.push({ type: "updateRegion", regionId: region.id, patch: { ownerTeamId: teamId, settlementTierId: tier.id } });
      lines.push(action.handler === "upgradeSettlement" ? `${regionName(region.id)} grew into a ${tier.name}.` : `You founded a ${tier.name} in ${regionName(region.id)}.`);
      break;
    }

    case "constructBuilding": {
      const def = r.buildings.find((b) => b.id === str(value("building")));
      if (!def || !region) break;
      p.changes.push({ type: "updateRegion", regionId: region.id, patch: { buildings: [...region.buildings, { buildingId: def.id, tier: 1 }] } });
      lines.push(`You built a ${def.name} in ${regionName(region.id)}.`);
      if (def.buildChoice === "ability") review(`Choose the ${def.name}'s ability in the Map editor (region ${region.code}).`);
      break;
    }

    case "upgradeBuilding": {
      const def = r.buildings.find((b) => b.id === str(value("building")));
      if (!def || !region) break;
      const buildings = region.buildings.map((b) => ({ ...b }));
      const placed = buildings.find((b) => b.buildingId === def.id)!;
      placed.tier++;
      p.changes.push({ type: "updateRegion", regionId: region.id, patch: { buildings } });
      lines.push(`You upgraded the ${def.name} in ${regionName(region.id)} to tier ${placed.tier}.`);
      break;
    }

    case "demolish": {
      const def = r.buildings.find((b) => b.id === str(value("building")));
      if (!def || !region) break;
      const i = region.buildings.findIndex((b) => b.buildingId === def.id);
      p.changes.push({ type: "updateRegion", regionId: region.id, patch: { buildings: region.buildings.filter((_, j) => j !== i) } });
      lines.push(`You demolished the ${def.name} in ${regionName(region.id)}${Object.keys(check.gain).length ? ` and salvaged ${fmtRes(check.gain, r.resources)}` : ""}.`);
      break;
    }

    case "annex": {
      if (!region) break;
      p.changes.push({ type: "updateRegion", regionId: region.id, patch: { ownerTeamId: teamId } });
      if (region.ownerTeamId) p.targetsTeams.push(region.ownerTeamId);
      for (const u of world.units.filter((x) => x.ownerTeamId === teamId && x.regionId === region.id && ACTIVE_STATUSES.has(x.status))) {
        const patch: Partial<WorldUnit> = {};
        if (action.config.endsMovement) patch.milesUsed = milesPerRound(r, u);
        if (action.config.revealsStealth && u.status === "hidden") patch.status = "active";
        if (Object.keys(patch).length) p.changes.push({ type: "updateUnit", unitId: u.id, patch });
      }
      lines.push(`You claimed ${regionName(region.id)}.`);
      break;
    }

    case "heal": {
      const pool = typeof action.config.poolHp === "number" ? action.config.poolHp : null;
      const rates = Array.isArray(action.config.rates) ? (action.config.rates as { resourceId: string; hpPer: number }[]) : [];
      let hp = 0;
      if (pool !== null) hp = pool;
      else {
        const paid = (value("resources") ?? {}) as Record<string, number>;
        for (const [k, v] of Object.entries(paid)) hp += (rates.find((x) => x.resourceId === k)?.hpPer ?? 0) * (typeof v === "number" ? v : 0);
      }
      const healed: string[] = [];
      for (const u of units) {
        if (hp <= 0) break;
        const max = maxHpOf(r, u);
        const amount = Math.min(hp, Math.max(0, max - u.hp));
        if (!amount) continue;
        hp -= amount;
        p.changes.push({ type: "updateUnit", unitId: u.id, patch: { hp: u.hp + amount } });
        healed.push(`${name(u)} +${amount} HP (${u.hp + amount}/${max})`);
      }
      lines.push(healed.length ? `Healed: ${healed.join("; ")}.` : "Nobody needed healing.");
      if (!healed.length && pool === null) review("No healing was paid for. Healers and Temples heal for free; apply that by hand if it applies.");
      break;
    }

    case "convert":
    case "market":
      lines.push(`${action.name}: ${fmtRes(check.cost, r.resources)} → ${fmtRes(check.gain, r.resources)}.`);
      break;

    case "applyAugment": {
      const item = r.items.find((x) => x.id === str(value("item")));
      const u = units[0];
      if (!item || !u) break;
      p.changes.push({ type: "inventory", teamId, itemId: item.id, delta: -1 });
      p.changes.push({ type: "updateUnit", unitId: u.id, patch: { augmentIds: [...u.augmentIds, item.id] } });
      lines.push(`${name(u)} equipped ${item.name}.`);
      break;
    }

    case "disband": {
      for (const u of units) {
        p.changes.push({ type: "updateUnit", unitId: u.id, patch: { status: "disbanded", augmentIds: [] } });
        for (const id of u.augmentIds) p.changes.push({ type: "inventory", teamId, itemId: id, delta: 1 });
        const refund = action.config.refundIfAboveHalfHp as ResourceAmounts | undefined;
        if (refund && u.hp > maxHpOf(r, u) / 2) {
          addTo(net, refund);
          lines.push(`${name(u)} was disbanded and you regained ${fmtRes(refund, r.resources)}.`);
        } else lines.push(`${name(u)} was disbanded.`);
      }
      break;
    }

    case "train": {
      const u = units[0];
      const academy = region?.buildings.find((b) => buildingTier(r, b)?.tier.effects.some((e) => e.type === "abilityChoiceBonus"));
      const bonus = academy ? buildingTier(r, academy)!.tier.effects.find((e) => e.type === "abilityChoiceBonus") : undefined;
      if (!u) break;
      if (!academy?.choice || bonus?.type !== "abilityChoiceBonus") {
        byHand("This region's Academy has no ability chosen. Set it in the Map editor, then apply the bonus by hand.");
        break;
      }
      p.changes.push({ type: "updateUnit", unitId: u.id, patch: { academyBonus: { [academy.choice]: bonus.amount } } });
      lines.push(`${name(u)} trained at the Academy: +${bonus.amount} ${academy.choice.toUpperCase()}.`);
      break;
    }

    case "craft":
    case "research": {
      const mode = str(value("choice"));
      if (action.handler === "craft" && mode !== "Research") {
        const recipe = r.recipes.find((x) => x.id === str(value("recipe")));
        if (!recipe) break;
        for (const i of recipe.inputs) p.changes.push({ type: "inventory", teamId, itemId: i.itemId, delta: -i.qty });
        for (const o of recipe.outputs) p.changes.push({ type: "inventory", teamId, itemId: o.itemId, delta: o.qty });
        lines.push(`You crafted ${recipe.outputs.map((o) => `${o.qty > 1 ? `${o.qty}× ` : ""}${r.items.find((x) => x.id === o.itemId)?.name ?? o.itemId}`).join(" and ")}.`);
        break;
      }
      const itemId = str(value("item"));
      const item = r.items.find((x) => x.id === itemId);
      const dice = typeof action.config.researchDice === "string" ? action.config.researchDice : "1d4";
      const roll = rollDice(dice, rng);
      p.rolls.push({ label: "Recipes learned", expression: dice, seed: rng.seed, breakdown: describeRoll(roll), total: roll.total, tableId: null, outcome: null });
      const unknown = r.recipes.filter((x) => !x.knownAtStart && !team.knownRecipeIds.includes(x.id) && x.inputs.some((i) => i.itemId === itemId));
      const learned: string[] = [];
      for (let i = 0; i < roll.total && unknown.length; i++) learned.push(unknown.splice(rng.int(0, unknown.length - 1), 1)[0].id);
      if (learned.length) p.changes.push({ type: "learnRecipes", teamId, recipeIds: learned });
      const names = learned.map((id) => r.recipes.find((x) => x.id === id)!.outputs.map((o) => r.items.find((x) => x.id === o.itemId)?.name ?? o.itemId).join(" + "));
      lines.push(learned.length ? `Studying ${item?.name ?? "the item"} taught you how to make: ${names.join(", ")}.` : `Studying ${item?.name ?? "the item"} taught you nothing new.`);
      review();
      break;
    }

    case "rollCheck": {
      if (!action.check) break;
      const choice = str(value("choice"));
      const byChoice = action.config.abilitiesByChoice as Record<string, Ability[]> | undefined;
      const abilities = (choice && byChoice?.[choice]) || action.check.abilities;
      const table = r.rollTables.find((t) => t.id === action.check!.tableId);
      const mods: Modifier[] = [];
      if (units.length) {
        // The best of the allowed abilities among the acting units, plus always-on check bonuses.
        let best: { label: string; value: number } | null = null;
        for (const u of units) {
          const c = r.creatures.find((x) => x.id === u.creatureId);
          if (!c) continue;
          const stats = deriveStats(c.statBlock, unitBonuses(r, u));
          for (const a of abilities) if (!best || stats.mods[a] > best.value) best = { label: `${name(u)} ${a.toUpperCase()}`, value: stats.mods[a] };
          for (const e of unitEffects(r, u)) if (e.type === "modifier" && e.target === `check:${action.id}` && e.when.length === 0) mods.push({ label: name(u), value: e.value });
        }
        if (best) mods.unshift(best);
      }
      if (table?.buildingBonus) {
        const bb = table.buildingBonus;
        const tiers = (region ? [region] : world.regions.filter((x) => x.ownerTeamId === teamId)).flatMap((x) => x.buildings.filter((b) => b.buildingId === bb.buildingId).map((b) => b.tier));
        const tier = Math.max(0, ...tiers);
        if (tier) mods.push({ label: r.buildings.find((b) => b.id === bb.buildingId)?.name ?? bb.buildingId, value: tier * bb.perTier });
      }
      const result = rollOnTable(r, action.check.tableId, rng, { label: action.name, modifiers: mods });
      p.rolls.push(...result.rolls);
      lines.push(...result.texts.filter(Boolean));
      applyTableResults(r, result.results, { p, rng, teamId, team, units, regionId, net, lines, name });
      review();
      break;
    }

    case "castSpell": {
      const spell = r.spells.find((x) => x.id === str(value("spell")));
      lines.push(`${unitList || "Your caster"} cast ${spell?.name ?? "a spell"}.`);
      byHand(`Resolve ${spell?.name ?? "the spell"} by hand${spell?.description ? `: ${spell.description}` : ""}.`);
      break;
    }

    case "raid": {
      const target = region;
      if (target?.ownerTeamId) p.targetsTeams.push(target.ownerTeamId);
      const fraction = typeof action.config.fraction === "number" ? action.config.fraction : 0.5;
      const tier = r.settlementTiers.find((t) => t.id === target?.settlementTierId);
      const prod: ResourceAmounts = { ...(tier?.production ?? {}) };
      for (const b of target?.buildings ?? []) addTo(prod, buildingTier(r, b)?.tier.production ?? {});
      const stolen = Object.fromEntries(Object.entries(prod).map(([k, v]) => [k, Math.floor(v * fraction)]));
      byHand(`Suggested haul: ${fmtRes(stolen, r.resources)} (${Math.round(fraction * 100)}% of ${regionName(target?.id)}'s production). Apply it with the resource adjustment, and take it from the owner.`);
      lines.push(`${unitList} raided ${regionName(target?.id)}.`);
      break;
    }

    default:
      byHand(`${action.name} is resolved by hand.`);
      if (unitList) lines.push(`${unitList}: ${action.name}.`);
  }

  // Resource cost, gains, and anything the handler added (refunds, table results).
  for (const k of Object.keys(net)) if (net[k] === 0) delete net[k];
  spend();
  const costText = Object.keys(check.cost).length ? ` (cost ${fmtRes(check.cost, r.resources)})` : "";
  p.text = lines.length ? lines.join(" ") + costText : `${action.name}${costText}.`;
  // Anything the DM has to check by hand means the order needs a look.
  if (p.status === "ready" && p.notes.length) p.status = "needsReview";
  return p;
}

/** Re-runs an order's fights many times with different dice: one summary per fight. */
export function orderCombatOdds(input: ResolveInput, runs = input.ruleset.settings.combat.oddsRuns): CombatOdds[] {
  const byFight: NonNullable<Proposal["combats"]>[] = [];
  for (let i = 0; i < runs; i++) {
    const p = resolveOrder({ ...input, seed: `${input.seed}:odds:${i}` });
    (p.combats ?? []).forEach((c, k) => (byFight[k] ??= []).push(c));
  }
  return byFight.map(summariseOdds);
}

/** Turns the structured results of a table roll into changes and notes. */
export function applyTableResults(
  r: Ruleset,
  results: Ruleset["rollTables"][number]["bands"][number]["results"],
  ctx: {
    p: Proposal;
    rng: ReturnType<typeof createRng>;
    teamId: string;
    team: World["teams"][number];
    units: WorldUnit[];
    regionId: string | null;
    net: ResourceAmounts;
    lines: string[];
    name: (u: WorldUnit) => string;
  },
) {
  const { p, rng, teamId, units, net } = ctx;
  const roll = (dice: string, label: string): number => {
    const d = rollDice(dice, rng);
    if (!/^\d+$/.test(dice.trim())) p.rolls.push({ label, expression: dice, seed: rng.seed, breakdown: describeRoll(d), total: d.total, tableId: null, outcome: null });
    return d.total;
  };
  const hpAfter = new Map(units.map((u) => [u.id, u.hp]));
  for (const res of results) {
    switch (res.type) {
      case "gainResource": {
        const n = roll(res.amount, `${r.resources.find((x) => x.id === res.resourceId)?.name ?? res.resourceId} gained`);
        net[res.resourceId] = (net[res.resourceId] ?? 0) + n;
        ctx.lines.push(`You gain ${n} ${r.resources.find((x) => x.id === res.resourceId)?.name ?? res.resourceId}.`);
        break;
      }
      case "gainItem": {
        const n = roll(res.qty, "Items found");
        p.changes.push({ type: "inventory", teamId, itemId: res.itemId, delta: n });
        ctx.lines.push(`You gain ${n}× ${r.items.find((x) => x.id === res.itemId)?.name ?? res.itemId}.`);
        break;
      }
      case "damageActor": {
        const u = units[0];
        if (!u) {
          p.notes.push(`The table deals ${res.dice} damage, but no unit was acting.`);
          break;
        }
        const dmg = roll(res.dice, `Damage to ${ctx.name(u)}`);
        const hp = Math.max(0, (hpAfter.get(u.id) ?? u.hp) - dmg);
        hpAfter.set(u.id, hp);
        p.changes.push({ type: "updateUnit", unitId: u.id, patch: hp === 0 ? { hp, status: "dead" } : { hp } });
        ctx.lines.push(`${ctx.name(u)} takes ${dmg} damage${hp === 0 ? " and dies" : ""}.`);
        break;
      }
      case "spawnMonster": {
        const where = units[0]?.regionId ?? ctx.regionId;
        const creature = r.creatures.find((c) => c.id === res.creatureId);
        if (!creature || !where) {
          p.notes.push(res.creatureId ? `Place a ${res.creatureId} by hand.` : "A monster appears: pick one and place it on the World map.");
          break;
        }
        const unit: WorldUnit = {
          id: globalThis.crypto.randomUUID(),
          ownerTeamId: null,
          creatureId: creature.id,
          name: "",
          raceId: null,
          archetypeId: null,
          academyBonus: {},
          augmentIds: [],
          hp: creature.statBlock.hp,
          regionId: where,
          milesUsed: 0,
          status: "active",
          isLeader: false,
          usesSpent: {},
        };
        p.changes.push({ type: "createUnit", unit });
        p.endsIn.push({ unitId: unit.id, regionId: where });
        p.notes.push(`A ${creature.statBlock.name} appears. It fights units that move into its region; teams can also attack it with an Attack order.`);
        break;
      }
      case "learnRecipes": {
        const n = roll(res.count, "Recipes learned");
        const unknown = r.recipes.filter((x) => !x.knownAtStart && !ctx.team.knownRecipeIds.includes(x.id));
        const learned: string[] = [];
        for (let i = 0; i < n && unknown.length; i++) learned.push(unknown.splice(rng.int(0, unknown.length - 1), 1)[0].id);
        if (learned.length) p.changes.push({ type: "learnRecipes", teamId, recipeIds: learned });
        break;
      }
      case "revealConnection":
        p.notes.push("Reveal a passage: unhide a connection (or draw a new one) in the Map editor, and tell the team.");
        break;
      case "revealRegion":
        p.notes.push("Reveal a new region: unhide a prepared region, or add one in the Map editor.");
        break;
      case "addDeposit":
        p.notes.push(`Add a deposit to the region in the Map editor${res.note ? ` (${res.note})` : ""}.`);
        break;
      case "findStructure":
        p.notes.push(`Add a ${res.kind} to the region in the Map editor.`);
        break;
      case "moveActor":
        p.notes.push(`Move the unit ${res.regions} region${res.regions === 1 ? "" : "s"}${res.random ? " in a random direction" : ""} on the World map.`);
        break;
      case "rollTable":
        break;
    }
  }
}
