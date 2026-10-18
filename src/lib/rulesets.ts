import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Ruleset, SECTION_SCHEMAS, type RulesetSection } from "@/engine/ruleset/ruleset";
import { findReferenceProblems, parseRuleset, type Problem } from "@/engine/ruleset/validate";
import { blankPreset } from "@/presets/blank";
import { buildPreset } from "@/presets";

export interface LoadedRuleset {
  ruleset: Ruleset;
  version: number;
}

export async function loadRuleset(gameId: string): Promise<LoadedRuleset> {
  const [row] = await db.select().from(schema.gameRulesets).where(eq(schema.gameRulesets.gameId, gameId)).limit(1);
  if (!row) {
    // Games created before rulesets existed start with a blank one.
    const ruleset = blankPreset();
    await db.insert(schema.gameRulesets).values({ gameId, data: ruleset }).onConflictDoNothing();
    return { ruleset, version: 1 };
  }
  const parsed = Ruleset.safeParse(row.data);
  if (!parsed.success) {
    throw new Error(`The stored ruleset for this game is invalid: ${parsed.error.issues[0]?.message}`);
  }
  return { ruleset: parsed.data, version: row.version };
}

export type SaveResult =
  | { ok: true; version: number; warnings: Problem[] }
  | { ok: false; error: string; problems: Problem[] };

async function store(gameId: string, ruleset: Ruleset, expectedVersion: number): Promise<SaveResult> {
  const updated = await db
    .update(schema.gameRulesets)
    .set({ data: ruleset, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(schema.gameRulesets.gameId, gameId), eq(schema.gameRulesets.version, expectedVersion)))
    .returning({ version: schema.gameRulesets.version });
  if (!updated.length) {
    return {
      ok: false,
      error: "Someone (maybe you, in another tab) saved changes since you opened this page. Reload to see them, then make your change again.",
      problems: [],
    };
  }
  return { ok: true, version: updated[0].version, warnings: findReferenceProblems(ruleset) };
}

/** Replaces one list (e.g. all buildings) after validating it. */
export async function saveSection(gameId: string, section: RulesetSection, items: unknown, expectedVersion: number): Promise<SaveResult> {
  const { ruleset } = await loadRuleset(gameId);
  const list = SECTION_SCHEMAS[section].array().safeParse(items);
  if (!list.success) {
    const merged = parseRuleset({ ...ruleset, [section]: items });
    return { ok: false, error: "Some fields aren't valid yet.", problems: merged.ok ? [] : merged.problems };
  }
  return store(gameId, { ...ruleset, [section]: list.data } as Ruleset, expectedVersion);
}

/** Replaces the whole ruleset (JSON import, settings page). */
export async function saveWholeRuleset(gameId: string, data: unknown, expectedVersion: number): Promise<SaveResult> {
  const parsed = parseRuleset(data);
  if (!parsed.ok) return { ok: false, error: "The ruleset isn't valid.", problems: parsed.problems };
  return store(gameId, parsed.ruleset, expectedVersion);
}

export async function createGameWithPreset(name: string, presetId: string) {
  const ruleset = buildPreset(presetId);
  return db.transaction(async (tx) => {
    const [game] = await tx.insert(schema.games).values({ name, presetId }).returning();
    await tx.insert(schema.gameRulesets).values({ gameId: game.id, data: ruleset });
    return game;
  });
}
