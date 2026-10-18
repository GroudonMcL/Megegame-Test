"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { OrderDraft, validateOrders } from "@/engine/orders/validate";
import { audit } from "@/lib/audit";
import { loadTeamView, ordersOpen } from "@/lib/teamView";
import { clearViewAs, getViewer } from "@/lib/viewer";

// Player actions. Each one re-checks who is asking and only ever touches that
// team's own rows.

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const SaveInput = z.object({
  orders: z.array(OrderDraft).max(60),
  /** The version the browser loaded; a mismatch means a teammate saved in between. */
  baseVersion: z.number().int().min(0),
  submit: z.boolean(),
  /** DM only: save even if checks fail. */
  bypass: z.boolean().default(false),
});

export async function saveOrdersAction(input: z.input<typeof SaveInput>): Promise<ActionResult<{ version: number; submitted: boolean }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended. Join again with your team code." };
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those orders couldn't be read." };
  if (JSON.stringify(parsed.data.orders).length > 200_000) return { ok: false, error: "Those orders are too long. Shorten some notes." };
  const { orders, baseVersion, submit } = parsed.data;
  const bypass = parsed.data.bypass && viewer.isDm;
  if (new Set(orders.map((o) => o.id)).size !== orders.length) return { ok: false, error: "Two orders have the same ID." };

  const loaded = await loadTeamView(viewer.gameId, viewer.teamId, { record: false });
  const round = loaded.round;
  if (!round) return { ok: false, error: "No round has been opened yet." };
  const open = ordersOpen(round);
  if (!open.open && !viewer.isDm) return { ok: false, error: open.reason };

  // Checked against the same fogged view the browser has, so the result never reveals hidden things.
  const check = validateOrders(loaded.rules, loaded.view, orders);
  if (submit && !check.ok && !bypass) {
    const first = check.orders.findIndex((c) => c.problems.length);
    return { ok: false, error: `Order ${first + 1}: ${check.orders[first].problems[0]}` };
  }

  const result = await db.transaction(async (tx) => {
    // Make sure the row exists, then lock it so two teammates can't save at once.
    await tx.insert(schema.teamRoundOrders).values({ roundId: round.id, teamId: viewer.teamId }).onConflictDoNothing();
    const [state] = await tx
      .select()
      .from(schema.teamRoundOrders)
      .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, viewer.teamId)))
      .for("update");
    const current = state?.version ?? 0;
    if (current !== baseVersion) return { conflict: true as const };

    await tx.delete(schema.orders).where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, viewer.teamId)));
    if (orders.length) {
      await tx.insert(schema.orders).values(
        orders.map((o, i) => ({
          id: o.id,
          roundId: round.id,
          teamId: viewer.teamId,
          position: i,
          kind: o.kind,
          slot: check.orders[i].slot,
          parentOrderId: check.orders[i].parentId,
          actionTypeId: o.actionTypeId,
          inputs: o.inputs,
          notes: o.notes,
          status: submit ? "submitted" : "draft",
          bypassed: bypass && check.orders[i].problems.length > 0,
          updatedAt: new Date(),
        })),
      );
    }
    const values = {
      version: current + 1,
      submittedAt: submit ? new Date() : null,
      submittedBy: submit ? viewer.displayName : null,
      updatedAt: new Date(),
      updatedBy: viewer.displayName,
    };
    await tx
      .update(schema.teamRoundOrders)
      .set(values)
      .where(and(eq(schema.teamRoundOrders.roundId, round.id), eq(schema.teamRoundOrders.teamId, viewer.teamId)));
    if (viewer.isDm) {
      await audit(tx, {
        gameId: viewer.gameId,
        actor: "dm",
        kind: "orders.edit",
        description: `${submit ? "Submitted" : "Saved"} ${orders.length} orders for ${viewer.team.name}${bypass ? " (checks bypassed)" : ""}`,
        after: orders,
      });
    }
    return { conflict: false as const, version: values.version };
  });

  if (result.conflict) return { ok: false, error: "A teammate changed these orders since you opened them. Reload the page to see their changes." };
  revalidatePath("/play", "layout");
  revalidatePath(`/dm/games/${viewer.gameId}`);
  return { ok: true, value: { version: result.version, submitted: submit } };
}

const UnitName = z.string().trim().max(60);

export async function renameUnitAction(unitId: string, name: string): Promise<ActionResult<string>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended." };
  const id = z.uuid().safeParse(unitId);
  const clean = UnitName.safeParse(name);
  if (!id.success || !clean.success) return { ok: false, error: "Names can be up to 60 characters." };
  const rows = await db
    .update(schema.units)
    .set({ name: clean.data })
    .where(and(eq(schema.units.id, id.data), eq(schema.units.ownerTeamId, viewer.teamId), eq(schema.units.gameId, viewer.gameId)))
    .returning({ id: schema.units.id });
  if (!rows.length) return { ok: false, error: "That unit isn't yours." };
  revalidatePath("/play", "layout");
  return { ok: true, value: clean.data };
}

/** Leaves "view as team" and goes back to the DM's game page. */
export async function stopViewingAs() {
  const viewer = await getViewer();
  await clearViewAs();
  redirect(viewer?.isDm ? `/dm/games/${viewer.gameId}` : "/dm");
}
