"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ResourceAmounts } from "@/engine/ruleset/common";
import {
  acceptOrder,
  applyEndOfRound,
  backToQueue,
  computeEndOfRound,
  failOrder,
  loadQueue,
  prepareStep,
  publishRound,
  rerollOrder,
  startResolving,
  undoLast,
} from "@/lib/resolution";
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

export const computeEndAction = async (gameId: string, reroll: boolean) => run(gameId, (id) => computeEndOfRound(id, reroll));
export const backToQueueAction = async (gameId: string) => run(gameId, (id) => backToQueue(id));
export const applyEndAction = async (gameId: string, adjust: Record<string, Record<string, number>>) =>
  run(gameId, (id) => applyEndOfRound(id, z.record(z.uuid(), ResourceAmounts).parse(adjust)));
export const publishAction = async (gameId: string) => run(gameId, (id) => publishRound(id));
