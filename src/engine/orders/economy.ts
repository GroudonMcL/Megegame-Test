import type { ResourceAmounts } from "../ruleset/common";
import { creatureCosts, unitBonuses } from "../ruleset/derive";
import type { Effect } from "../ruleset/effects";
import type { Ruleset } from "../ruleset/ruleset";
import type { WorldRegion, WorldUnit } from "../world/types";

// A team's round economy: Start / End / Total change, with ad-hoc costs
// (orders, events, trades), upkeep (buildings, settlements, units) and income
// (buildings, settlements, passive), as in the Utterdark summary sheet.

export type EconomyGroup = "orders" | "buildings" | "settlements" | "units" | "passive";

export interface EconomyLine {
  group: EconomyGroup;
  label: string;
  amounts: ResourceAmounts;
}

export interface Economy {
  start: ResourceAmounts;
  /** Positive amounts are spent (orders); gains from orders are negative costs. */
  adhoc: EconomyLine[];
  upkeep: EconomyLine[];
  income: EconomyLine[];
  change: ResourceAmounts;
  end: ResourceAmounts;
}

export function addTo(target: ResourceAmounts, amounts: ResourceAmounts, factor = 1) {
  for (const [k, v] of Object.entries(amounts)) target[k] = (target[k] ?? 0) + v * factor;
}

export function total(lines: EconomyLine[]): ResourceAmounts {
  const out: ResourceAmounts = {};
  for (const l of lines) addTo(out, l.amounts);
  return out;
}

function nonZero(a: ResourceAmounts) {
  return Object.values(a).some((v) => v !== 0);
}

/** Units in these states cost upkeep. */
const UPKEEP_STATUSES = new Set(["active", "hidden", "tamed", "captured"]);

/** All effects that apply to a unit: its creature's, plus race, archetype and augments. */
export function unitEffects(r: Ruleset, u: WorldUnit): Effect[] {
  const creature = r.creatures.find((c) => c.id === u.creatureId);
  return [...(creature?.effects ?? []), ...unitBonuses(r, u).flatMap((b) => b.effects ?? [])];
}

/** What one unit costs each round. */
export function unitUpkeep(r: Ruleset, u: WorldUnit): ResourceAmounts {
  if (u.isLeader) return {};
  const creature = r.creatures.find((c) => c.id === u.creatureId);
  if (!creature) return {};
  const out: ResourceAmounts = { ...creatureCosts(creature, r).upkeep };
  const archetype = r.archetypes.find((a) => a.id === u.archetypeId);
  if (archetype) addTo(out, archetype.extraUpkeep);
  for (const e of unitEffects(r, u)) if (e.type === "waiveUpkeep") for (const id of e.resourceIds) delete out[id];
  return out;
}

/** The current tier definition of a placed building, if it exists. */
export function buildingTier(r: Ruleset, b: { buildingId: string; tier: number }) {
  const def = r.buildings.find((x) => x.id === b.buildingId);
  const tier = def?.tiers[b.tier - 1];
  return def && tier ? { def, tier } : null;
}

export function projectEconomy(
  r: Ruleset,
  input: {
    teamId: string;
    resources: ResourceAmounts;
    regions: (Pick<WorldRegion, "id" | "code" | "name" | "ownerTeamId" | "settlementTierId" | "buildings"> & { deposits: { name: string; production?: ResourceAmounts }[] })[];
    units: WorldUnit[];
    adhoc?: EconomyLine[];
  },
): Economy {
  const upkeep: EconomyLine[] = [];
  const income: EconomyLine[] = [];
  const where = (reg: { code: string; name: string }) => (reg.name ? `${reg.code} ${reg.name}` : reg.code);

  for (const reg of input.regions) {
    if (reg.ownerTeamId !== input.teamId) continue;
    const tier = r.settlementTiers.find((t) => t.id === reg.settlementTierId);
    if (tier) {
      if (nonZero(tier.production)) income.push({ group: "settlements", label: `${tier.name}, ${where(reg)}`, amounts: tier.production });
      if (nonZero(tier.upkeep)) upkeep.push({ group: "settlements", label: `${tier.name}, ${where(reg)}`, amounts: tier.upkeep });
    }
    for (const b of reg.buildings) {
      const bt = buildingTier(r, b);
      if (!bt) continue;
      const label = `${bt.def.name}${bt.def.tiers.length > 1 ? ` ${b.tier}` : ""}, ${where(reg)}`;
      if (nonZero(bt.tier.production)) income.push({ group: "buildings", label, amounts: bt.tier.production });
      if (nonZero(bt.tier.upkeep)) upkeep.push({ group: "buildings", label, amounts: bt.tier.upkeep });
    }
    for (const d of reg.deposits) {
      if (d.production && nonZero(d.production)) income.push({ group: "passive", label: `${d.name}, ${where(reg)}`, amounts: d.production });
    }
  }

  for (const u of input.units) {
    if (u.ownerTeamId !== input.teamId || !UPKEEP_STATUSES.has(u.status)) continue;
    const amounts = unitUpkeep(r, u);
    if (nonZero(amounts)) {
      const name = u.name || r.creatures.find((c) => c.id === u.creatureId)?.statBlock.name || "Unit";
      upkeep.push({ group: "units", label: name, amounts });
    }
  }

  const adhoc = input.adhoc ?? [];
  const change: ResourceAmounts = {};
  addTo(change, total(adhoc), -1);
  addTo(change, total(upkeep), -1);
  addTo(change, total(income));
  const end: ResourceAmounts = { ...input.resources };
  addTo(end, change);
  return { start: input.resources, adhoc, upkeep, income, change, end };
}
