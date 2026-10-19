import type { Ruleset } from "../ruleset/ruleset";
import { milesPerRound } from "../orders/movement";
import type { Change, World } from "../resolve/types";
import type { WorldUnit } from "../world/types";
import { simulateCombat } from "./simulate";
import type { CombatResult, CombatSideInput } from "./types";

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

/** The game changes a fight makes. */
export function fightChanges(r: Ruleset, world: World, res: CombatResult, opts: { reveal?: string[] } = {}): Change[] {
  const changes: Change[] = [];
  const byId = new Map(world.units.map((u) => [u.id, u]));
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
          augmentIds: [],
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
  return changes;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A short account of a fight from one side's point of view. Enemy hit points aren't given away. */
export function fightSummary(world: World, res: CombatResult, sideId: string): string {
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
  return `${head}: ${verdict} after ${plural(res.rounds, "round")}. Your units: ${ownText}. Enemies: ${enemyBits.join(", ") || "none"}.`;
}
