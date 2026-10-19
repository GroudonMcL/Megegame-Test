"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EMBLEM_IDS } from "@/components/icons/emblems";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";

// The DM changes a team's details after it's been created: name, colour,
// emblem, races, resources, secret objectives and notes.

const TeamEdit = z.object({
  name: z.string().trim().min(1, "Give the team a name.").max(60),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour."),
  emblem: z.enum(EMBLEM_IDS as [string, ...string[]], "Pick an emblem."),
  isNpc: z.boolean(),
  baseRaceId: z.string().nullable(),
  raceIds: z.array(z.string()).max(100),
  resources: z.record(z.string(), z.number().finite()),
  secretObjectives: z.string().max(5000),
  notes: z.string().max(5000),
});
export type TeamEditInput = z.input<typeof TeamEdit>;

export async function updateTeamAction(gameId: string, teamId: string, input: TeamEditInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireDm();
  const parsed = TeamEdit.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ruleset } = await loadRuleset(gameId);
  const races = new Set(ruleset.races.map((r) => r.id));
  const d = parsed.data;
  if (d.baseRaceId !== null && !races.has(d.baseRaceId)) return { ok: false, error: "Unknown race." };
  if (d.raceIds.some((id) => !races.has(id))) return { ok: false, error: "Unknown race." };
  // Keep resource ids the ruleset knows; drop anything else.
  const resources = Object.fromEntries(ruleset.resources.map((r) => [r.id, d.resources[r.id] ?? 0]));
  const raceIds = [...new Set(d.raceIds.filter((id) => id !== d.baseRaceId))];
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.teams).where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId))).limit(1);
    if (!before) return { ok: false as const, error: "Team not found." };
    const [after] = await tx
      .update(schema.teams)
      .set({ name: d.name, colour: d.colour, emblem: d.emblem, isNpc: d.isNpc, baseRaceId: d.baseRaceId, raceIds, resources, secretObjectives: d.secretObjectives, notes: d.notes })
      .where(eq(schema.teams.id, teamId))
      .returning();
    await audit(tx, { gameId, actor: "dm", kind: "team.update", description: `Edited team ${after.name}`, before, after });
    revalidatePath(`/dm/games/${gameId}`, "layout");
    return { ok: true as const };
  });
}
