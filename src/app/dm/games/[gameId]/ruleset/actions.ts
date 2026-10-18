"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RULESET_SECTIONS, type RulesetSection } from "@/engine/ruleset/ruleset";
import { searchSrd, srdByIndex } from "@/engine/srd/library";
import { requireDm } from "@/lib/session";
import { saveSection, saveWholeRuleset } from "@/lib/rulesets";
import { buildPreset } from "@/presets";

const GameId = z.uuid();

export async function saveSectionAction(gameId: string, section: RulesetSection, items: unknown[], version: number) {
  await requireDm();
  if (!(RULESET_SECTIONS as readonly string[]).includes(section)) throw new Error("Unknown section");
  const result = await saveSection(GameId.parse(gameId), section, items, version);
  if (result.ok) revalidatePath(`/dm/games/${gameId}/ruleset`, "layout");
  return result;
}

export async function saveWholeAction(gameId: string, data: unknown, version: number) {
  await requireDm();
  const result = await saveWholeRuleset(GameId.parse(gameId), data, version);
  if (result.ok) revalidatePath(`/dm/games/${gameId}/ruleset`, "layout");
  return result;
}

export async function searchSrdAction(q: { text: string; type: string; maxCr: number | null }) {
  await requireDm();
  return searchSrd({ text: q.text, type: q.type || undefined, maxCr: q.maxCr ?? undefined }).slice(0, 200);
}

export async function fetchSrdAction(index: string) {
  await requireDm();
  const m = srdByIndex(index);
  return m ? { index: m.index, statBlock: m.statBlock } : null;
}

export async function presetAction(presetId: string) {
  await requireDm();
  return buildPreset(presetId);
}
