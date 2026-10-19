import { createRng } from "../rng";
import { describeRoll, rollDice } from "../dice";
import type { ResourceAmounts } from "../ruleset/common";
import type { Effect } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import { addTo, buildingTier, projectEconomy, type Economy } from "../orders/economy";
import { ACTIVE_STATUSES, type WorldUnit } from "../world/types";
import { executeTrade, type TradeInput, type TradeOutcome } from "../trades";
import { applyChanges } from "./apply";
import { applyTableResults } from "./resolveOrder";
import { rollOnTable } from "./rollTable";
import type { Change, Proposal, RollRecord, World } from "./types";

// The end-of-round phase: production and upkeep, per-round building rolls,
// region hazards, and an economy-deficit roll for any team that goes negative.
// Movement resets are done by the server when this is applied.

export interface TeamRoundEnd {
  teamId: string;
  economy: Economy;
  rolls: RollRecord[];
  lines: string[];
  notes: string[];
  /** Resource and other changes, including the economy itself. */
  changes: Change[];
}

export interface RoundEnd {
  teams: TeamRoundEnd[];
  /** Hazard damage to wild monsters (not owned by any team). */
  wild: { rolls: RollRecord[]; changes: Change[]; lines: string[] };
  /** Accepted trades, checked against the state after everything above. */
  trades: TradeOutcome[];
}

export interface EndOfRoundOptions {
  /** Roll this event table for these teams. */
  events?: { tableId: string; teamIds: string[] } | null;
  /** Accepted trades, in the order they were accepted. */
  trades?: TradeInput[];
}

function blank(): Proposal {
  return { status: "ready", problems: [], notes: [], rolls: [], changes: [], text: "", regions: [], targetsTeams: [], endsIn: [] };
}

export function endOfRound(r: Ruleset, world: World, seed: string, opts: EndOfRoundOptions = {}): RoundEnd {
  const rng = createRng(seed);
  const regionName = (id: string) => {
    const reg = world.regions.find((x) => x.id === id);
    return reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "?";
  };
  const unitName = (u: WorldUnit) => u.name || r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name || "a unit";
  const out: RoundEnd = { teams: [], wild: { rolls: [], changes: [], lines: [] }, trades: [] };
  const eventTable = opts.events ? r.rollTables.find((x) => x.id === opts.events!.tableId) : undefined;

  for (const team of world.teams) {
    const economy = projectEconomy(r, { teamId: team.id, resources: team.resources, regions: world.regions, units: world.units });
    const t: TeamRoundEnd = { teamId: team.id, economy, rolls: [], lines: [], notes: [], changes: [] };
    const net: ResourceAmounts = { ...economy.change };

    // Buildings and settlements that roll on a table every round.
    for (const reg of world.regions.filter((x) => x.ownerTeamId === team.id)) {
      const effects: { source: string; e: Effect }[] = [];
      const tier = r.settlementTiers.find((x) => x.id === reg.settlementTierId);
      for (const e of tier?.effects ?? []) effects.push({ source: tier!.name, e });
      for (const b of reg.buildings) for (const e of buildingTier(r, b)?.tier.effects ?? []) effects.push({ source: buildingTier(r, b)!.def.name, e });
      for (const { source, e } of effects) {
        if (e.type !== "rollEachRound") continue;
        const res = rollOnTable(r, e.tableId, rng, { label: `${source}, ${reg.code}` });
        t.rolls.push(...res.rolls);
        const p = blank();
        const lines: string[] = [];
        applyTableResults(r, res.results, { p, rng, teamId: team.id, team, units: [], regionId: reg.id, net, lines, name: unitName });
        t.changes.push(...p.changes);
        t.rolls.push(...p.rolls);
        t.notes.push(...p.notes);
        t.lines.push(`${source} (${reg.code}): ${[...res.texts, ...lines].filter(Boolean).join(" ")}`);
      }
    }

    // A random event for this team, if the DM rolls them this round.
    if (eventTable && opts.events!.teamIds.includes(team.id)) {
      const owned = world.regions.filter((x) => x.ownerTeamId === team.id).length;
      const bonus = eventTable.perRegionsBonus ? Math.floor(owned / eventTable.perRegionsBonus) : 0;
      const res = rollOnTable(r, eventTable.id, rng, { label: `${eventTable.name}`, modifiers: bonus ? [{ label: `${owned} regions`, value: bonus }] : [] });
      t.rolls.push(...res.rolls);
      const p = blank();
      const lines: string[] = [];
      const home = world.regions.find((x) => x.ownerTeamId === team.id)?.id ?? null;
      applyTableResults(r, res.results, { p, rng, teamId: team.id, team, units: [], regionId: home, net, lines, name: unitName });
      t.changes.push(...p.changes);
      t.rolls.push(...p.rolls);
      t.notes.push(...p.notes);
      t.lines.push(`Event: ${res.texts.filter(Boolean).join(" → ")}.${lines.length ? ` ${lines.join(" ")}` : ""}`);
      if (eventTable.modifierNote) t.notes.push(`The event roll also adds: ${eventTable.modifierNote}`);
    }

    // Going negative triggers a roll on that resource's deficit table (or a general one).
    const end: ResourceAmounts = { ...team.resources };
    addTo(end, net);
    const negative = r.resources.filter((x) => x.kind === "stockpile" && (end[x.id] ?? 0) < 0);
    if (negative.length) t.notes.push(`Ends the round with negative ${negative.map((x) => x.name).join(" and ")}.`);
    const deficits = r.rollTables.filter((x) => x.category === "deficit");
    const general = deficits.find((x) => !x.deficitResourceId);
    let rolledGeneral = false;
    for (const res of negative) {
      const table = deficits.find((x) => x.deficitResourceId === res.id) ?? (rolledGeneral ? undefined : general);
      if (!table) continue;
      if (table === general) rolledGeneral = true;
      const short = -(end[res.id] ?? 0);
      const mods = table.deficitPerUnit ? [{ label: `${short} ${res.name} short`, value: Math.ceil(short * table.deficitPerUnit) }] : [];
      const rolled = rollOnTable(r, table.id, rng, { label: `${table.name} (${res.name})`, modifiers: mods });
      t.rolls.push(...rolled.rolls);
      t.lines.push(`${res.name} deficit: ${rolled.texts.filter(Boolean).join(" ")}`);
      t.notes.push(`Apply the ${res.name} deficit event by hand if it needs more than resources${table.modifierNote ? ` (the table also adds: ${table.modifierNote})` : ""}.`);
    }
    if (Object.values(net).some((v) => v !== 0)) t.changes.unshift({ type: "resources", teamId: team.id, delta: Object.fromEntries(Object.entries(net).filter(([, v]) => v !== 0)) });
    out.teams.push(t);
  }

  // Region hazards that strike at the start of each round.
  for (const reg of world.regions) {
    for (const e of reg.features) {
      if (e.type !== "regionDamage" || e.trigger !== "roundStart") continue;
      for (const u of world.units.filter((x) => x.regionId === reg.id && ACTIVE_STATUSES.has(x.status))) {
        if (e.unlessItemTag && u.augmentIds.some((id) => r.items.find((i) => i.id === id)?.tags.includes(e.unlessItemTag!))) continue;
        const d = rollDice(e.dice, rng);
        const roll: RollRecord = { label: `${regionName(reg.id)} hazard on ${unitName(u)}`, expression: e.dice, seed, breakdown: describeRoll(d), total: d.total, tableId: null, outcome: null };
        const hp = Math.max(0, u.hp - d.total);
        const change: Change = { type: "updateUnit", unitId: u.id, patch: hp === 0 ? { hp, status: "dead" } : { hp } };
        const line = `${unitName(u)} took ${d.total} ${e.damageType} damage in ${regionName(reg.id)}${hp === 0 ? " and died" : ""}.`;
        const t = out.teams.find((x) => x.teamId === u.ownerTeamId);
        const bucket = t ?? out.wild;
        bucket.rolls.push(roll);
        bucket.changes.push(change);
        bucket.lines.push(line);
      }
    }
  }
  // Accepted trades execute last, against the state after everything above.
  if (opts.trades?.length) {
    let after = applyChanges(world, [...out.teams.flatMap((t) => t.changes), ...out.wild.changes]);
    for (const trade of opts.trades) {
      const res = executeTrade(r, after, trade);
      out.trades.push(res);
      if (res.ok) after = applyChanges(after, res.changes.filter((c): c is Change => c.type !== "shareMap"));
    }
  }
  return out;
}
