import type { Ruleset } from "../ruleset/ruleset";
import { itemsText, mergeItems, unitItems } from "../equipment";
import { milesPerRound } from "../orders/movement";
import type { Change, World } from "../resolve/types";
import type { ItemQty, WorldUnit } from "../world/types";
import { simulateCombat } from "./simulate";
import type { CombatResult, CombatSideInput, FightLoot, LootChoice } from "./types";

// Sets up fights from the game state, and turns their results into changes,
// outcome text for the attacking team, and reports for the other teams involved.

export const WILD = "wild";

export interface FightOptions {
  /** sideId → enemy unit that side concentrates on. */
  priority?: Record<string, string>;
}

/** Where a unit retreats to: where it came from, else a neighbouring region its team owns, else any neighbour. */
export function retreatRegion(world: World, unit: WorldUnit, regionId: string, cameFrom?: string | null): string | null {
  if (cameFrom && cameFrom !== regionId) return cameFrom;
  const neighbours = world.connections
    .filter((c) => !c.hidden && !c.blocked && (c.regionA === regionId || c.regionB === regionId))
    .map((c) => (c.regionA === regionId ? c.regionB : c.regionA))
    .map((id) => world.regions.find((x) => x.id === id))
    .filter((x): x is World["regions"][number] => Boolean(x && !x.hidden))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return (neighbours.find((x) => unit.ownerTeamId && x.ownerTeamId === unit.ownerTeamId) ?? neighbours[0])?.id ?? null;
}

/** The units that defend a region against an attack on `target`: its whole side, as long as they're out in the open. */
export function defendersOf(world: World, target: WorldUnit, regionId: string): WorldUnit[] {
  return world.units.filter(
    (u) => u.regionId === regionId && (u.id === target.id || u.status === "active") && u.ownerTeamId === target.ownerTeamId,
  );
}

export function wildIn(world: World, regionId: string): WorldUnit[] {
  return world.units.filter((u) => u.regionId === regionId && u.ownerTeamId === null && u.status === "active");
}

export function sideName(world: World, teamId: string | null) {
  return teamId ? (world.teams.find((t) => t.id === teamId)?.name ?? "Unknown faction") : "Wild monsters";
}

export function sideFor(world: World, teamId: string | null, units: WorldUnit[], extra: Partial<CombatSideInput> = {}): CombatSideInput {
  return { id: teamId ?? WILD, teamId, name: sideName(world, teamId), units, ...extra };
}

export function runFight(r: Ruleset, world: World, regionId: string, sides: CombatSideInput[], seed: string, opts: FightOptions & { capture?: { sideId: string; targetId: string } } = {}): CombatResult {
  return simulateCombat({
    ruleset: r,
    region: world.regions.find((x) => x.id === regionId) ?? null,
    sides,
    seed,
    priority: opts.priority,
    capture: opts.capture,
  });
}

const itemNamer = (r: Ruleset) => (id: string) => r.items.find((x) => x.id === id)?.name ?? id;

/** Teams with a unit still standing on the winning side of a fight. */
export function winningTeams(world: World, res: CombatResult): string[] {
  const side = res.sides.find((s) => s.id === res.winner);
  if (!side?.teamId) return [];
  const byId = new Map(world.units.map((u) => [u.id, u]));
  const teams = res.units
    .filter((u) => u.sideId === side.id && u.outcome === "standing")
    .map((u) => (u.raised ? u.raised.teamId : (byId.get(u.unitId)?.ownerTeamId ?? null)))
    .filter((t): t is string => Boolean(t));
  // The side's own team first, so it's the default for a split.
  return [...new Set(teams)].sort((a, b) => Number(b === side.teamId) - Number(a === side.teamId));
}

/** Does a split hand out exactly the loot, only to winning teams? */
export function splitMatches(items: ItemQty[], teamIds: string[], shares: Record<string, ItemQty[]>): boolean {
  if (Object.keys(shares).some((t) => !teamIds.includes(t))) return false;
  const given = mergeItems(Object.values(shares));
  const want = mergeItems([items]);
  return given.length === want.length && want.every((x) => given.find((g) => g.itemId === x.itemId)?.qty === x.qty);
}

/** "Loot from the fight in A3, for Iron Clan and Ash Court to share out between you: …", the suggested note for the "note" choice. */
export function lootNoteText(world: World, loot: Pick<FightLoot, "items" | "teamIds">, regionId: string | null, itemName: (id: string) => string): string {
  const reg = world.regions.find((x) => x.id === regionId);
  const where = reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "the fight";
  const teams = loot.teamIds.map((t) => sideName(world, t));
  const names = teams.length > 1 ? `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)}` : (teams[0] ?? "");
  return `Loot from the fight in ${where}, for ${names} to share out between you: ${itemsText(loot.items, itemName)}. Agree how to split it and tell the DM.`;
}

/**
 * What the units that died in a fight had on them, and who gets it. With one
 * winning team it all goes to that team; with several, the DM's choice
 * (default: everything to the side's own team until the DM splits it).
 */
export function fightLoot(r: Ruleset, world: World, res: CombatResult, choice?: LootChoice): FightLoot | undefined {
  const byId = new Map(world.units.map((u) => [u.id, u]));
  const from = res.units
    .filter((u) => u.outcome === "dead" && !u.raised)
    .map((u) => {
      const unit = byId.get(u.unitId);
      return { unitId: u.unitId, label: u.label.replace(/ \[.*\]$/, ""), items: unit ? unitItems(unit) : [] };
    })
    .filter((x) => x.items.length);
  if (!from.length) return undefined;
  const items = mergeItems(from.map((x) => x.items));
  const teamIds = winningTeams(world, res);
  const base = { items, from, teamIds };
  if (!teamIds.length) return { ...base, mode: "corpse", shares: {} };
  if (teamIds.length === 1) return { ...base, mode: "auto", shares: { [teamIds[0]]: items } };
  if (choice?.mode === "note") return { ...base, mode: "note", shares: {}, note: choice.text?.trim() || lootNoteText(world, base, res.regionId, itemNamer(r)) };
  if (choice?.mode === "split" && splitMatches(items, teamIds, choice.shares)) {
    const shares = Object.fromEntries(Object.entries(choice.shares).map(([t, l]) => [t, mergeItems([l])]).filter(([, l]) => l.length));
    return { ...base, mode: "split", shares };
  }
  return { ...base, mode: "split", shares: { [teamIds[0]]: items }, splitReset: choice?.mode === "split" };
}

/** The fight log's line about the loot. */
export function lootLogText(world: World, loot: FightLoot, itemName: (id: string) => string): string {
  const all = itemsText(loot.items, itemName);
  switch (loot.mode) {
    case "corpse":
      return `Nobody won the fallen's gear, so it stays with them: ${all}.`;
    case "note":
      return `Loot for ${loot.teamIds.map((t) => sideName(world, t)).join(" and ")} to share out between them: ${all}.`;
    default:
      return `Loot: ${Object.entries(loot.shares)
        .map(([t, l]) => `${sideName(world, t)} takes ${itemsText(l, itemName)}`)
        .join("; ")}.`;
  }
}

/** The loot, as a sentence for one team's results ("" = nothing to say). */
export function lootSentence(world: World, loot: FightLoot | undefined, teamId: string | null, itemName: (id: string) => string): string {
  if (!loot || loot.mode === "corpse") return "";
  if (loot.mode === "note") {
    const others = loot.teamIds.filter((t) => t !== teamId).map((t) => sideName(world, t));
    return loot.teamIds.includes(teamId ?? "")
      ? `Loot to share out with ${others.join(" and ")}: ${itemsText(loot.items, itemName)}. The DM has sent you a note about it.`
      : `The winners took the fallen's gear: ${itemsText(loot.items, itemName)}.`;
  }
  const mine = teamId ? loot.shares[teamId] : undefined;
  const others = Object.entries(loot.shares).filter(([t]) => t !== teamId);
  return [
    mine?.length ? `You took as loot: ${itemsText(mine, itemName)}.` : "",
    others.length ? `${others.map(([t, l]) => `${sideName(world, t)} took ${itemsText(l, itemName)}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The game changes a fight makes. */
export function fightChanges(r: Ruleset, world: World, res: CombatResult, opts: { reveal?: string[] } = {}): Change[] {
  const changes: Change[] = [];
  const byId = new Map(world.units.map((u) => [u.id, u]));
  // The fallen lose what they had to the winners (unless nobody won it).
  const looted = new Set(res.loot && res.loot.mode !== "corpse" ? res.loot.from.map((x) => x.unitId) : []);
  for (const u of res.units) {
    const side = res.sides.find((s) => s.id === u.sideId);
    if (u.raised) {
      if (u.outcome === "dead" || !res.regionId) continue;
      const c = r.creatures.find((x) => x.id === u.raised!.creatureId);
      if (!c) continue;
      changes.push({
        type: "createUnit",
        unit: {
          id: globalThis.crypto.randomUUID(),
          ownerTeamId: u.raised.teamId,
          creatureId: c.id,
          name: "",
          raceId: null,
          archetypeId: null,
          academyBonus: {},
          equippedItemIds: [],
          hp: u.hp,
          regionId: res.regionId,
          x: null,
          y: null,
          milesUsed: 0,
          status: "active",
          isLeader: false,
          usesSpent: {},
        },
      });
      continue;
    }
    const before = byId.get(u.unitId);
    if (!before) continue;
    const patch: Extract<Change, { type: "updateUnit" }>["patch"] = {};
    if (u.hp !== before.hp) patch.hp = u.hp;
    if (u.outcome === "dead") patch.status = "dead";
    if (looted.has(u.unitId)) {
      patch.equippedItemIds = [];
      patch.carried = [];
    }
    else if (u.outcome === "captured") {
      patch.status = "captured";
      const capturer = res.sides.find((s) => s.id === res.winner);
      if (capturer?.teamId) patch.ownerTeamId = capturer.teamId;
    } else if (opts.reveal?.includes(u.unitId) && before.status === "hidden") patch.status = "active";
    if (JSON.stringify(u.usesSpent) !== JSON.stringify(before.usesSpent ?? {})) patch.usesSpent = u.usesSpent;
    if (Object.keys(patch).length) changes.push({ type: "updateUnit", unitId: u.unitId, patch });
    if (u.outcome === "retreated" && u.retreatTo && side?.teamId) {
      changes.push({ type: "moveUnit", unitId: u.unitId, regionId: u.retreatTo, milesUsed: milesPerRound(r, before) });
    }
  }
  for (const [teamId, list] of Object.entries(res.loot?.shares ?? {})) {
    for (const x of list) changes.push({ type: "inventory", teamId, itemId: x.itemId, delta: x.qty });
  }
  return changes;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A short account of a fight from one side's point of view, with any loot. Enemy hit points aren't given away. */
export function fightSummary(world: World, res: CombatResult, sideId: string, r?: Ruleset): string {
  const regionOf = (id: string | null) => {
    const reg = world.regions.find((x) => x.id === id);
    return reg ? (reg.name ? `${reg.code} ${reg.name}` : reg.code) : "an unknown region";
  };
  const enemies = res.sides.filter((s) => s.id !== sideId);
  const head = `Fight in ${regionOf(res.regionId)} against ${enemies.map((s) => s.name).join(" and ")}`;
  if (res.endReason === "noFight") return `${head}: there was nobody to fight.`;
  const verdict =
    res.endReason === "captured"
      ? res.winner === sideId
        ? "you captured the monster"
        : "the monster was captured"
      : res.winner === sideId
        ? "you won"
        : res.winner
          ? "you lost"
          : "nobody won";
  const own = res.units.filter((u) => u.sideId === sideId);
  const ownText = own
    .map((u) => {
      const name = u.label.replace(/ \[.*\]$/, "");
      if (u.outcome === "dead") return `${name} died`;
      if (u.outcome === "retreated") return `${name} retreated to ${regionOf(u.retreatTo)} (${u.hp}/${u.maxHp} HP)`;
      if (u.outcome === "captured") return `${name} was captured`;
      return `${name} ${u.raised ? "rose to fight for you" : "stands"} (${u.hp}/${u.maxHp} HP)`;
    })
    .join("; ");
  const theirs = res.units.filter((u) => u.sideId !== sideId);
  const count = (o: string) => theirs.filter((u) => u.outcome === o).length;
  const enemyBits = [
    count("dead") && `${plural(count("dead"), "enemy unit")} destroyed`,
    count("retreated") && `${count("retreated")} fled`,
    count("captured") && `${count("captured")} captured`,
    count("standing") && `${count("standing")} still standing`,
  ].filter(Boolean);
  const side = res.sides.find((s) => s.id === sideId);
  const loot = r ? lootSentence(world, res.loot, side?.teamId ?? null, itemNamer(r)) : "";
  return `${head}: ${verdict} after ${plural(res.rounds, "round")}. Your units: ${ownText}. Enemies: ${enemyBits.join(", ") || "none"}.${loot ? ` ${loot}` : ""}`;
}
