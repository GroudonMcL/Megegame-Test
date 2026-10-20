// Once for each game created before fights had approach rounds: gives the
// ranged attacks, save effects and spells in the game's saved ruleset a range
// (from their text, or from the Utterdark preset for its spells and bombs),
// so archers get to shoot before melee units reach them. Runs after the SQL
// migrations (scripts/migrate.ts). Later games start from the new presets and
// SRD data, and a range the DM already set is kept.
import { and, eq, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { fillRanges, presetRanges } from "../src/engine/ruleset/fillRanges";
import { buildPreset, PRESETS } from "../src/presets";

type Db = PostgresJsDatabase<typeof schema>;

/** When ranges were added: only games created before this are updated. */
const CHANGED_AT = new Date("2026-10-21T00:00:00Z");
const KIND = "ruleset.ranges";

export async function fillRangesInGames(db: Db) {
  const games = await db.select({ id: schema.games.id, name: schema.games.name, presetId: schema.games.presetId }).from(schema.games).where(lt(schema.games.createdAt, CHANGED_AT));
  const fromPreset = new Map(PRESETS.map((p) => [p.id, presetRanges(buildPreset(p.id))]));
  for (const game of games) {
    await db.transaction(async (tx) => {
      const [done] = await tx
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.gameId, game.id), eq(schema.auditLog.kind, KIND)))
        .limit(1);
      if (done) return;
      const [rules] = await tx.select().from(schema.gameRulesets).where(eq(schema.gameRulesets.gameId, game.id));
      const { data, changed } = fillRanges(rules?.data ?? {}, fromPreset.get(game.presetId));
      if (rules && changed.length) {
        await tx.update(schema.gameRulesets).set({ data, version: rules.version + 1, updatedAt: new Date() }).where(eq(schema.gameRulesets.gameId, game.id));
      }
      const description = changed.length ? `Gave ${changed.length} attacks and effects a range for the approach before a fight: ${changed.join("; ")}` : "No attacks or effects needed a range";
      await tx.insert(schema.auditLog).values({ gameId: game.id, actor: "engine", kind: KIND, description });
      if (changed.length) console.log(`${game.name}: ${changed.length} ranges filled in`);
    });
  }
}
