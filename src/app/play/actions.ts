"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { effectiveKind, OrderDraft, validateOrders } from "@/engine/orders/validate";
import { renameDescription } from "@/engine/dmEdits";
import { audit } from "@/lib/audit";
import { editInventory, editRecipes, ordersStateFor, undoDmChange, type OrdersState, type RenameState } from "@/lib/dmEdits";
import { lendUnit } from "@/lib/lending";
import { markRead, postMessage, sendDmNote, TeamNoteInput } from "@/lib/messages";
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
  /** DM only: a note to the team about the change. */
  note: TeamNoteInput,
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
    // The DM's change is undoable, so keep the list it replaces.
    const before = viewer.isDm ? await ordersStateFor(tx, round.id, viewer.teamId, current, state) : null;

    await tx.delete(schema.orders).where(and(eq(schema.orders.roundId, round.id), eq(schema.orders.teamId, viewer.teamId)));
    if (orders.length) {
      await tx.insert(schema.orders).values(
        orders.map((o, i) => ({
          id: o.id,
          roundId: round.id,
          teamId: viewer.teamId,
          position: i,
          kind: effectiveKind(loaded.rules, o),
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
      const after: OrdersState = { roundId: round.id, version: values.version, submittedAt: values.submittedAt?.toISOString() ?? null, submittedBy: values.submittedBy };
      await audit(tx, {
        gameId: viewer.gameId,
        actor: "dm",
        kind: "dm.orders",
        teamId: viewer.teamId,
        description: `${submit ? "Submitted" : "Saved"} ${orders.length} orders for ${viewer.team.name}${bypass ? " (checks bypassed)" : ""}`,
        before,
        after,
      });
      await sendDmNote(tx, viewer.gameId, viewer.teamId, parsed.data.note);
    }
    return { conflict: false as const, version: values.version };
  });

  if (result.conflict) return { ok: false, error: "A teammate changed these orders since you opened them. Reload the page to see their changes." };
  revalidatePath("/play", "layout");
  revalidatePath(`/dm/games/${viewer.gameId}`);
  return { ok: true, value: { version: result.version, submitted: submit } };
}

const UnitName = z.string().trim().max(60);

export async function renameUnitAction(unitId: string, name: string, note?: unknown): Promise<ActionResult<string>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended." };
  const id = z.uuid().safeParse(unitId);
  const clean = UnitName.safeParse(name);
  if (!id.success || !clean.success) return { ok: false, error: "Names can be up to 60 characters." };
  const mine = and(eq(schema.units.id, id.data), eq(schema.units.ownerTeamId, viewer.teamId), eq(schema.units.gameId, viewer.gameId));
  const error = await db.transaction(async (tx) => {
    const [unit] = await tx.select({ name: schema.units.name }).from(schema.units).where(mine).for("update");
    if (!unit) return "That unit isn't yours.";
    if (unit.name === clean.data) return null;
    await tx.update(schema.units).set({ name: clean.data }).where(mine);
    if (viewer.isDm) {
      const before: RenameState = { unitId: id.data, name: unit.name };
      const after: RenameState = { unitId: id.data, name: clean.data };
      const description = renameDescription(unit.name, clean.data, viewer.team.name);
      await audit(tx, { gameId: viewer.gameId, actor: "dm", kind: "dm.rename", teamId: viewer.teamId, description, before, after });
      const parsedNote = TeamNoteInput.safeParse(note);
      if (parsedNote.success) await sendDmNote(tx, viewer.gameId, viewer.teamId, parsedNote.data);
    }
    return null;
  });
  if (error) return { ok: false, error };
  revalidatePath("/play", "layout");
  return { ok: true, value: clean.data };
}

/** Lend one of the team's units to a team it has met (toTeamId), or take it back (null). */
export async function lendUnitAction(unitId: string, toTeamId: string | null, note?: unknown): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended." };
  const id = z.uuid().safeParse(unitId);
  const to = z.uuid().nullable().safeParse(toTeamId);
  const parsedNote = TeamNoteInput.safeParse(note);
  if (!id.success || !to.success || !parsedNote.success) return { ok: false, error: "That unit or team wasn't found." };
  const error = await lendUnit(viewer.gameId, viewer.teamId, id.data, to.data, { isDm: viewer.isDm, displayName: viewer.displayName, note: parsedNote.data });
  if (error) return { ok: false, error };
  revalidatePath("/play", "layout");
  revalidatePath(`/dm/games/${viewer.gameId}`, "layout");
  return { ok: true, value: null };
}

// ——— The DM's extra powers in "view as team" ———

async function requireDmViewer() {
  const viewer = await getViewer();
  return viewer?.isDm ? viewer : null;
}

const DmInventory = z.object({ items: z.record(z.string().max(100), z.number().int().min(0).max(1_000_000)), note: TeamNoteInput });

/** DM only: set item quantities in the team's inventory (0 removes the item). */
export async function dmEditInventoryAction(input: z.input<typeof DmInventory>): Promise<ActionResult<null>> {
  const viewer = await requireDmViewer();
  if (!viewer) return { ok: false, error: "Only the DM can do that." };
  const parsed = DmInventory.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Quantities must be whole numbers from 0 to 1,000,000." };
  const error = await editInventory(viewer.gameId, viewer.teamId, parsed.data.items, parsed.data.note);
  if (error) return { ok: false, error };
  revalidatePath("/play", "layout");
  return { ok: true, value: null };
}

const DmRecipes = z.object({ recipes: z.record(z.string().max(100), z.boolean()), note: TeamNoteInput });

/** DM only: teach (true) or forget (false) recipes. */
export async function dmEditRecipesAction(input: z.input<typeof DmRecipes>): Promise<ActionResult<null>> {
  const viewer = await requireDmViewer();
  if (!viewer) return { ok: false, error: "Only the DM can do that." };
  const parsed = DmRecipes.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those recipes couldn't be read." };
  const error = await editRecipes(viewer.gameId, viewer.teamId, parsed.data.recipes, parsed.data.note);
  if (error) return { ok: false, error };
  revalidatePath("/play", "layout");
  return { ok: true, value: null };
}

/** DM only: undo one of the DM's changes to this team. */
export async function dmUndoAction(auditId: string, note?: unknown): Promise<ActionResult<null>> {
  const viewer = await requireDmViewer();
  if (!viewer) return { ok: false, error: "Only the DM can do that." };
  const id = z.uuid().safeParse(auditId);
  const parsedNote = TeamNoteInput.safeParse(note);
  if (!id.success || !parsedNote.success) return { ok: false, error: "That change wasn't found." };
  const error = await undoDmChange(viewer.gameId, viewer.teamId, id.data, parsedNote.data);
  if (error) return { ok: false, error };
  revalidatePath("/play", "layout");
  revalidatePath(`/dm/games/${viewer.gameId}`, "layout");
  return { ok: true, value: null };
}

// ——— Messages with the DM ———

/** A player writes to the DM, or the DM (viewing as the team) writes to the team. */
export async function sendMessageAction(text: string): Promise<ActionResult<null>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended. Join again with your team code." };
  if (typeof text !== "string") return { ok: false, error: "Write a message first." };
  const error = await postMessage(db, { gameId: viewer.gameId, teamId: viewer.teamId, fromDm: viewer.isDm, authorName: viewer.isDm ? "DM" : viewer.displayName, text });
  if (error) return { ok: false, error };
  // Writing counts as reading: the sender has seen everything before it.
  await markRead(viewer.gameId, viewer.teamId, viewer.isDm ? "dm" : "team");
  revalidatePath("/play", "layout");
  revalidatePath(`/dm/games/${viewer.gameId}`, "layout");
  return { ok: true, value: null };
}

/** Leaves "view as team" and goes back to the DM's game page. */
export async function stopViewingAs() {
  const viewer = await getViewer();
  await clearViewAs();
  redirect(viewer?.isDm ? `/dm/games/${viewer.gameId}` : "/dm");
}
