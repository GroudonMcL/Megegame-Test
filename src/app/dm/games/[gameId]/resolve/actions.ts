"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { ResourceAmounts } from "@/engine/ruleset/common";
import {
  acceptOrder,
  applyEndOfRound,
  backToQueue,
  computeEndOfRound,
  computeOdds,
  failOrder,
  loadQueue,
  prepareStep,
  publishRound,
  rerollOrder,
  setFightSettings,
  startResolving,
  undoLast,
} from "@/lib/resolution";
import { appOrigin, notifyPublished } from "@/lib/discord";
import { requireDm } from "@/lib/session";

// The DM's resolution controls. Each re-checks the DM session and works only
// on the game's current round.

export type Result = { ok: true; message?: string } | { ok: false; error: string };

const GameId = z.uuid();
const OrderId = z.uuid();
const Decision = z.object({ text: z.string().max(10000), adjust: ResourceAmounts, hideRolls: z.boolean() });

async function run(gameId: string, fn: (id: string) => Promise<Result | void>): Promise<Result> {
  await requireDm();
  const id = GameId.parse(gameId);
  try {
    const r = await fn(id);
    return r ?? { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  } finally {
    revalidatePath(`/dm/games/${id}`, "layout");
    revalidatePath("/play", "layout");
  }
}

export const startResolvingAction = async (gameId: string) => run(gameId, (id) => startResolving(id));
export const prepareStepAction = async (gameId: string, step: number) => run(gameId, (id) => prepareStep(id, z.number().int().min(0).parse(step)));
export const rerollAction = async (gameId: string, orderId: string) => run(gameId, (id) => rerollOrder(id, OrderId.parse(orderId)));
export const acceptAction = async (gameId: string, orderId: string, decision: z.input<typeof Decision>) =>
  run(gameId, (id) => acceptOrder(id, OrderId.parse(orderId), Decision.parse(decision)));
export const failAction = async (gameId: string, orderId: string, text: string, status: "failed" | "skipped") =>
  run(gameId, (id) => failOrder(id, OrderId.parse(orderId), z.string().max(10000).parse(text), z.enum(["failed", "skipped"]).parse(status)));

const FightSettings = z.object({
  priority: z.record(z.string().max(64), z.uuid()).optional(),
  byHand: z.boolean().optional(),
  shareLog: z.boolean().optional(),
  overrides: z.record(z.uuid(), z.object({ hp: z.number().int().min(0).max(100000).optional(), outcome: z.enum(["standing", "dead", "retreated"]).optional() })).optional(),
});
export const fightSettingsAction = async (gameId: string, orderId: string, settings: z.input<typeof FightSettings>) =>
  run(gameId, (id) => setFightSettings(id, OrderId.parse(orderId), FightSettings.parse(settings)));
export const oddsAction = async (gameId: string, orderId: string) => run(gameId, (id) => computeOdds(id, OrderId.parse(orderId)));

/** Accepts every order in a step whose proposal is "ready", in queue order. */
export const acceptAllReadyAction = async (gameId: string, step: number) =>
  run(gameId, async (id) => {
    const { steps } = await loadQueue(id);
    const s = steps.find((x) => x.step === step);
    let n = 0;
    for (const item of s?.items ?? []) {
      const o = item.outcome;
      if (item.order.status !== "prepared" || o?.proposal.status !== "ready" || item.backup === "waiting") continue;
      const r = await acceptOrder(id, item.order.id, { text: o.text, adjust: o.adjust, hideRolls: o.hideRolls });
      if (r.ok) n++;
    }
    return { ok: true, message: `Accepted ${n} order${n === 1 ? "" : "s"}.` };
  });

export const undoAction = async (gameId: string) =>
  run(gameId, async (id) => {
    const what = await undoLast(id);
    return what ? { ok: true, message: `Undone: ${what}` } : { ok: false, error: "Nothing to undo." };
  });

export const computeEndAction = async (gameId: string, reroll: boolean, events?: { tableId: string; teamIds: string[] } | null) =>
  run(gameId, (id) =>
    computeEndOfRound(
      id,
      reroll,
      events === undefined ? undefined : events === null ? null : z.object({ tableId: z.string().max(64), teamIds: z.array(z.uuid()).max(200) }).parse(events),
    ),
  );
export const backToQueueAction = async (gameId: string) => run(gameId, (id) => backToQueue(id));
export const applyEndAction = async (gameId: string, adjust: Record<string, Record<string, number>>) =>
  run(gameId, (id) => applyEndOfRound(id, z.record(z.uuid(), ResourceAmounts).parse(adjust)));
export const publishAction = async (gameId: string) =>
  run(gameId, async (id) => {
    const number = await publishRound(id);
    const origin = await appOrigin();
    after(() => notifyPublished(id, number, origin));
  });
