import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { equipBlocked, equipProblems, withEquipped, withUnequipped } from "@/engine/equipment";
import type { TeamNote } from "@/engine/messages";
import { audit } from "./audit";
import { sendDmNote } from "./messages";
import { loadRuleset } from "./rulesets";
import { ordersOpen } from "./teamView";
import { toWorldUnit } from "./world";

// A team equipping an item from its inventory on one of its units, or
// unequipping it back into the inventory. The rules are in
// src/engine/equipment.ts. Logged as "unit.equip" / "unit.unequip"; when the DM
// does it while viewing as the team, as "dm.equip" (undoable from the team's
// DM log). The DM can also change a unit's archetype ("dm.archetype").

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** dm.equip: the unit's equipment and the team's stock of the item. */
export interface EquipState {
  unitId: string;
  itemId: string;
  equippedItemIds: string[];
  unequipped: { round: number; itemIds: string[] } | null;
  /** How many of the item the team had. */
  qty: number;
}

/** dm.archetype */
export interface ArchetypeState {
  unitId: string;
  archetypeId: string | null;
}

export interface EquipBy {
  isDm: boolean;
  displayName: string;
  note?: TeamNote;
}

async function currentRoundRow(tx: Tx, gameId: string) {
  const [game] = await tx.select({ round: schema.games.currentRound }).from(schema.games).where(eq(schema.games.id, gameId));
  const [round] = game
    ? await tx
        .select()
        .from(schema.rounds)
        .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.round)))
    : [];
  return round ?? null;
}

async function itemQty(tx: Tx, teamId: string, itemId: string): Promise<number> {
  const [row] = await tx
    .select({ qty: schema.inventory.qty })
    .from(schema.inventory)
    .where(and(eq(schema.inventory.teamId, teamId), eq(schema.inventory.itemId, itemId)));
  return row?.qty ?? 0;
}

export async function setItemQty(tx: Tx, teamId: string, itemId: string, qty: number) {
  if (qty > 0)
    await tx
      .insert(schema.inventory)
      .values({ teamId, itemId, qty })
      .onConflictDoUpdate({
        target: [schema.inventory.teamId, schema.inventory.itemId],
        set: { qty },
      });
  else await tx.delete(schema.inventory).where(and(eq(schema.inventory.teamId, teamId), eq(schema.inventory.itemId, itemId)));
}

/**
 * Equips (or unequips) one item on the team's unit, moving it out of (or into)
 * the inventory. The DM viewing as the team may skip the checks except having
 * the item (force). Returns an error, or null when done.
 */
export async function changeEquipment(gameId: string, teamId: string, unitId: string, change: { kind: "equip" | "unequip"; itemId: string; force?: boolean }, by: EquipBy): Promise<string | null> {
  const { ruleset } = await loadRuleset(gameId);
  const item = ruleset.items.find((x) => x.id === change.itemId);
  if (!item) return "That item isn't in the rules.";
  return db.transaction(async (tx) => {
    // The team row is the lock for its inventory (as for the DM's inventory edits).
    const [team] = await tx
      .select()
      .from(schema.teams)
      .where(and(eq(schema.teams.id, teamId), eq(schema.teams.gameId, gameId)))
      .for("update");
    if (!team) return "Team not found.";
    const round = await currentRoundRow(tx, gameId);
    const roundNumber = round?.number ?? 0;
    const rows = await tx
      .select()
      .from(schema.units)
      .where(and(eq(schema.units.gameId, gameId), eq(schema.units.ownerTeamId, teamId)))
      .for("update");
    const row = rows.find((u) => u.id === unitId);
    if (!row) return "That unit isn't yours.";
    const unit = toWorldUnit(row);
    const [region] = unit.regionId ? await tx.select({ owner: schema.regions.ownerTeamId }).from(schema.regions).where(eq(schema.regions.id, unit.regionId)) : [];
    if (!by.isDm) {
      const blocked = equipBlocked(unit, {
        teamId,
        roundOpen: ordersOpen(round),
        regionOwner: region?.owner,
      });
      if (blocked) return blocked;
    }
    const qty = await itemQty(tx, teamId, item.id);
    let next;
    if (change.kind === "equip") {
      if (qty <= 0) return `You don't have a ${item.name}.`;
      const problems = equipProblems(ruleset, unit, item.id, {
        inventory: { [item.id]: qty },
        teamUnits: rows.map(toWorldUnit),
        round: roundNumber,
      });
      if (problems.length && !(by.isDm && change.force)) return problems[0];
      next = withEquipped(unit, item.id, roundNumber);
    } else {
      next = withUnequipped(unit, item.id, roundNumber);
      if (!next) return `${item.name} isn't equipped on that unit.`;
    }
    const newQty = qty + (change.kind === "equip" ? -1 : 1);
    await tx.update(schema.units).set(next).where(eq(schema.units.id, unit.id));
    await setItemQty(tx, teamId, item.id, newQty);
    const unitName = unit.name || ruleset.creatures.find((c) => c.id === unit.creatureId)?.statBlock.name || "a unit";
    const description = change.kind === "equip" ? `Equipped ${item.name} on ${unitName} (${team.name})` : `Unequipped ${item.name} from ${unitName} (${team.name})`;
    const before: EquipState = {
      unitId,
      itemId: item.id,
      equippedItemIds: unit.equippedItemIds,
      unequipped: unit.unequipped ?? null,
      qty,
    };
    const after: EquipState = {
      unitId,
      itemId: item.id,
      equippedItemIds: next.equippedItemIds,
      unequipped: next.unequipped ?? null,
      qty: newQty,
    };
    await audit(tx, {
      gameId,
      actor: by.isDm ? "dm" : by.displayName,
      kind: by.isDm ? "dm.equip" : `unit.${change.kind}`,
      teamId,
      description,
      before,
      after,
    });
    if (by.isDm) await sendDmNote(tx, gameId, teamId, by.note);
    return null;
  });
}

/** DM only: sets or changes a team unit's archetype (null = none). */
export async function setArchetype(gameId: string, teamId: string, unitId: string, archetypeId: string | null, note?: TeamNote): Promise<string | null> {
  const { ruleset } = await loadRuleset(gameId);
  const archetype = archetypeId ? ruleset.archetypes.find((a) => a.id === archetypeId) : null;
  if (archetypeId && !archetype) return "That archetype isn't in the rules.";
  return db.transaction(async (tx) => {
    const mine = and(eq(schema.units.id, unitId), eq(schema.units.gameId, gameId), eq(schema.units.ownerTeamId, teamId));
    const [unit] = await tx.select().from(schema.units).where(mine).for("update");
    if (!unit) return "That unit isn't this team's.";
    if (unit.archetypeId === archetypeId) return null;
    await tx.update(schema.units).set({ archetypeId }).where(mine);
    const [team] = await tx.select({ name: schema.teams.name }).from(schema.teams).where(eq(schema.teams.id, teamId));
    const unitName = unit.name || ruleset.creatures.find((c) => c.id === unit.creatureId)?.statBlock.name || "a unit";
    const description = `Made ${unitName} ${archetype ? `a ${archetype.name}` : "have no archetype"} (${team?.name ?? "team"})`;
    const before: ArchetypeState = { unitId, archetypeId: unit.archetypeId };
    const after: ArchetypeState = { unitId, archetypeId };
    await audit(tx, {
      gameId,
      actor: "dm",
      kind: "dm.archetype",
      teamId,
      description,
      before,
      after,
    });
    await sendDmNote(tx, gameId, teamId, note);
    return null;
  });
}

/** Undoes a dm.equip change, if the unit and the item's stock are still as it left them. */
export async function undoEquip(tx: Tx, gameId: string, teamId: string, before: EquipState, after: EquipState, since: string): Promise<string | null> {
  const [unit] = await tx
    .select({ equipped: schema.units.equippedItemIds })
    .from(schema.units)
    .where(and(eq(schema.units.id, after.unitId), eq(schema.units.gameId, gameId), eq(schema.units.ownerTeamId, teamId)))
    .for("update");
  if (!unit || JSON.stringify(unit.equipped) !== JSON.stringify(after.equippedItemIds)) return `The unit's equipment ${since}`;
  if ((await itemQty(tx, teamId, after.itemId)) !== after.qty) return `The team's stock of that item ${since}`;
  await tx
    .update(schema.units)
    .set({
      equippedItemIds: before.equippedItemIds,
      unequipped: before.unequipped,
    })
    .where(eq(schema.units.id, after.unitId));
  await setItemQty(tx, teamId, after.itemId, before.qty);
  return null;
}

/** Undoes a dm.archetype change, if the unit still has the archetype it left. */
export async function undoArchetype(tx: Tx, gameId: string, teamId: string, before: ArchetypeState, after: ArchetypeState, since: string): Promise<string | null> {
  const rows = await tx
    .update(schema.units)
    .set({ archetypeId: before.archetypeId })
    .where(
      and(
        eq(schema.units.id, after.unitId),
        eq(schema.units.gameId, gameId),
        eq(schema.units.ownerTeamId, teamId),
        after.archetypeId === null ? isNull(schema.units.archetypeId) : eq(schema.units.archetypeId, after.archetypeId),
      ),
    )
    .returning({ archetypeId: schema.units.archetypeId });
  return rows.length ? null : `The unit's archetype ${since}`;
}
