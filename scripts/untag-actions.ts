// Once for each game created before the Utterdark preset dropped its
// unit-type requirements (only Regiments raid, only Miners excavate…): drops
// them from the game's saved ruleset too, so any unit can take those actions.
// Runs after the SQL migrations (scripts/migrate.ts). Later games start from
// the new preset, and a DM who adds such a requirement back keeps it.
import { and, eq, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { dropUnitRequirements } from "../src/engine/ruleset/untag";

type Db = PostgresJsDatabase<typeof schema>;

/** When the preset changed: only games created before this are updated. */
const CHANGED_AT = new Date("2026-10-20T00:00:00Z");
const KIND = "ruleset.untag";

export async function untagActions(db: Db) {
  const games = await db.select({ id: schema.games.id, name: schema.games.name }).from(schema.games).where(lt(schema.games.createdAt, CHANGED_AT));
  for (const game of games) {
    await db.transaction(async (tx) => {
      const [done] = await tx
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.gameId, game.id), eq(schema.auditLog.kind, KIND)))
        .limit(1);
      if (done) return;
      const [rules] = await tx.select().from(schema.gameRulesets).where(eq(schema.gameRulesets.gameId, game.id));
      const data = (rules?.data ?? {}) as { actionTypes?: Parameters<typeof dropUnitRequirements>[0] };
      const { actions, changed } = dropUnitRequirements(data.actionTypes ?? []);
      if (rules && changed.length) {
        await tx
          .update(schema.gameRulesets)
          .set({ data: { ...data, actionTypes: actions }, version: rules.version + 1, updatedAt: new Date() })
          .where(eq(schema.gameRulesets.gameId, game.id));
      }
      const description = changed.length ? `Any unit can now take these actions (they needed a particular kind of unit): ${changed.join(", ")}` : "No actions needed a particular kind of unit";
      await tx.insert(schema.auditLog).values({ gameId: game.id, actor: "engine", kind: KIND, description });
      if (changed.length) console.log(`${game.name}: ${description}`);
    });
  }
}
