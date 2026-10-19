// Creates a big test game (15 teams, 160 regions, ~300 units, a full round of
// orders) for checking the app stays quick at the size of a real megagame.
// Run with `npm run seed:load-test` against a local or test database, never the
// live one: it only adds a new game, but it's a large one.
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { parseConnectionString } from "../src/db/connectionString";
import * as schema from "../src/db/schema";
import { generateJoinCode } from "../src/lib/joinCode";
import { buildPreset } from "../src/presets";
import { adjacentPairs } from "../src/engine/geo/regions";

config({ path: ".env.local" });
config();

const TEAMS = 15;
const SIDE = 13; // 13 × 13 grid = 169 regions, a few left out below
const UNITS_PER_TEAM = 18;
const MONSTERS = 40;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres({ ...parseConnectionString(url), prepare: false, max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const ruleset = buildPreset("utterdark");
  const hpOf = (creatureId: string) => ruleset.creatures.find((c) => c.id === creatureId)!.statBlock.hp;
  const rand = mulberry(42);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  await db.transaction(async (tx) => {
    const [game] = await tx
      .insert(schema.games)
      .values({ name: `Load test (${TEAMS} teams) ${new Date().toISOString().slice(0, 16)}`, presetId: "utterdark", status: "running", currentRound: 1 })
      .returning();
    await tx.insert(schema.gameRulesets).values({ gameId: game.id, data: ruleset });

    // Square regions on a grid, with a few gaps (open ground) so the map isn't perfectly regular.
    const cells: { col: number; row: number }[] = [];
    for (let row = 0; row < SIDE; row++) for (let col = 0; col < SIDE; col++) if ((row * 7 + col * 3) % 19 !== 0) cells.push({ col, row });
    const square = (c: { col: number; row: number }): [number, number][] => [
      [c.col / SIDE, c.row / SIDE],
      [(c.col + 1) / SIDE, c.row / SIDE],
      [(c.col + 1) / SIDE, (c.row + 1) / SIDE],
      [c.col / SIDE, (c.row + 1) / SIDE],
    ];
    const regions = await tx
      .insert(schema.regions)
      .values(cells.map((c) => ({ gameId: game.id, code: `${String.fromCharCode(65 + c.row)}${c.col + 1}`, x: (c.col + 0.5) / SIDE, y: (c.row + 0.5) / SIDE, polygon: square(c) })))
      .returning();
    // Squares that touch (sides or corners) are neighbours.
    const links = adjacentPairs(regions.map((r) => ({ id: r.id, polygon: r.polygon })));
    const connections = await tx
      .insert(schema.connections)
      .values(links.map(([a, b]) => ({ gameId: game.id, regionA: a, regionB: b, kind: "border" })))
      .returning();
    const neighbours = new Map<string, string[]>();
    for (const c of connections) {
      neighbours.set(c.regionA, [...(neighbours.get(c.regionA) ?? []), c.regionB]);
      neighbours.set(c.regionB, [...(neighbours.get(c.regionB) ?? []), c.regionA]);
    }

    // Teams, each with a home settlement spread around the map.
    const start = Object.fromEntries(ruleset.resources.map((r) => [r.id, r.startingAmount ?? 0]));
    const teams = await tx
      .insert(schema.teams)
      .values(
        Array.from({ length: TEAMS }, (_, i) => ({
          gameId: game.id,
          name: `Team ${i + 1}`,
          colour: hue((i * 360) / TEAMS),
          joinCode: generateJoinCode(),
          baseRaceId: ruleset.races[i % ruleset.races.length].id,
          raceIds: [ruleset.races[i % ruleset.races.length].id],
          resources: start,
        })),
      )
      .returning();
    const homes = teams.map((_, i) => regions[Math.floor(((i + 0.5) * regions.length) / TEAMS)]);
    for (const [i, t] of teams.entries()) {
      await tx
        .update(schema.regions)
        .set({ ownerTeamId: t.id, settlementTierId: ruleset.settlementTiers[1]?.id ?? null, buildings: [] })
        .where(eq(schema.regions.id, homes[i].id));
    }

    // Units: each team's around its home; wild monsters scattered.
    const standard = ["guard", "warrior-infantry", "priest-acolyte", "scout", "tough"].filter((id) => ruleset.creatures.some((c) => c.id === id));
    const wild = ["giant-spider", "giant-lizard", "ghoul", "gelatinous-cube", "rust-monster"].filter((id) => ruleset.creatures.some((c) => c.id === id));
    const unitRows: (typeof schema.units.$inferInsert)[] = [];
    for (const [i, t] of teams.entries()) {
      const near = [homes[i].id, ...(neighbours.get(homes[i].id) ?? [])];
      for (let u = 0; u < UNITS_PER_TEAM; u++) {
        const creatureId = pick(standard);
        unitRows.push({ gameId: game.id, ownerTeamId: t.id, creatureId, raceId: t.baseRaceId, hp: hpOf(creatureId), regionId: pick(near), isLeader: u === 0 });
      }
    }
    for (let m = 0; m < MONSTERS; m++) {
      const creatureId = pick(wild);
      unitRows.push({ gameId: game.id, ownerTeamId: null, creatureId, hp: hpOf(creatureId), regionId: pick(regions).id });
    }
    const units = await tx.insert(schema.units).values(unitRows).returning();

    // Each team knows the regions within two steps of home.
    const knowledge: (typeof schema.teamRegionKnowledge.$inferInsert)[] = [];
    for (const [i, t] of teams.entries()) {
      const known = new Set([homes[i].id]);
      for (let step = 0; step < 2; step++) for (const id of [...known]) for (const n of neighbours.get(id) ?? []) known.add(n);
      for (const regionId of known) knowledge.push({ teamId: t.id, regionId });
    }
    await tx.insert(schema.teamRegionKnowledge).values(knowledge);

    // Round 1 open, with six move orders per team, all submitted.
    const [round] = await tx.insert(schema.rounds).values({ gameId: game.id, number: 1, status: "open", openedAt: new Date(), deadline: new Date(Date.now() + 3 * 86400_000) }).returning();
    const orders: (typeof schema.orders.$inferInsert)[] = [];
    for (const t of teams) {
      const mine = units.filter((u) => u.ownerTeamId === t.id);
      for (let slot = 1; slot <= ruleset.settings.actionSlots; slot++) {
        const u = mine[slot % mine.length];
        const to = regions.find((r) => r.id === pick(neighbours.get(u.regionId!) ?? [u.regionId!]))!;
        // A path is a list of points on the map; this one walks to the neighbour's centre.
        orders.push({ roundId: round.id, teamId: t.id, position: slot - 1, kind: "numbered", slot, actionTypeId: "move", inputs: { "0": [u.id], "1": [[to.x, to.y]] }, status: "submitted" });
      }
    }
    await tx.insert(schema.orders).values(orders);
    await tx.insert(schema.teamRoundOrders).values(teams.map((t) => ({ roundId: round.id, teamId: t.id, version: 1, submittedAt: new Date(), submittedBy: "load test" })));

    console.log(`Created "${game.name}": ${teams.length} teams, ${regions.length} regions, ${connections.length} connections, ${units.length} units, ${orders.length} orders.`);
    console.log(`Join codes: ${teams.map((t) => t.joinCode).join(", ")}`);
    console.log(`DM page: /dm/games/${game.id}`);
  });
  await client.end();
}

/** A mid-brightness colour at this hue, as #rrggbb (the only form the app accepts). */
function hue(h: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = 0.5 - 0.5 * 0.65 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
