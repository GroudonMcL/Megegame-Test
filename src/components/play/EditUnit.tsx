"use client";

import { useState, useTransition } from "react";
import { dmSetArchetypeAction, equipItemAction, unequipItemAction } from "@/app/play/actions";
import { useTeamNote } from "@/components/dm/TeamNoteOption";
import { Modal } from "@/components/shell/Modal";
import { Button } from "@/components/ui";
import { equipBlocked, equipMax, equipProblems, isEquippable } from "@/engine/equipment";
import { describeEffect, namesFrom } from "@/engine/ruleset/effects";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { WorldUnit } from "@/engine/world/types";
import { useOrdersDraft } from "./ordersDraft";
import { RenameUnit } from "./RenameUnit";
import { useViewerInfo } from "./viewerInfo";

// The Edit window for one of the team's units: rename it, and equip items
// from the team's inventory or unequip them back into it. Equipment changes
// happen straight away, only while the round is open and the unit is in a
// region the team owns (unequip or re-equip to undo). The DM editing as the
// team can do it any time, skip the item's requirements, and change the
// unit's archetype (teams choose it only when recruiting).

const small = "rounded-md border border-border px-2 py-0.5 text-xs hover:border-border-strong disabled:opacity-50";

export function EditUnit({ unit: u, rules }: { unit: WorldUnit; rules: Ruleset }) {
  const [open, setOpen] = useState(false);
  const creature = rules.creatures.find((c) => c.id === u.creatureId);
  const name = u.name || creature?.statBlock.name || "Unit";
  return (
    <>
      <Button variant="secondary" className="px-3! py-1! text-xs" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${name}`}>
        <EditUnitBody unit={u} rules={rules} />
      </Modal>
    </>
  );
}

function EditUnitBody({ unit: u, rules }: { unit: WorldUnit; rules: Ruleset }) {
  const { isDm, view } = useViewerInfo();
  const draft = useOrdersDraft();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const names = namesFrom(rules);
  const creature = rules.creatures.find((c) => c.id === u.creatureId);
  const unitName = u.name || creature?.statBlock.name || "a unit";
  const itemName = (id: string) => rules.items.find((x) => x.id === id)?.name ?? id;
  const note = useTeamNote(`The DM changed ${unitName}'s equipment.`);

  const teamId = view?.team.id ?? u.ownerTeamId ?? "";
  const round = draft.roundNumber ?? 0;
  const regionOwner = view?.regions.find((x) => x.id === u.regionId)?.ownerTeamId;
  const blocked = equipBlocked(u, {
    teamId,
    roundOpen: draft.open,
    regionOwner,
  });
  const inventory = view?.inventory ?? {};
  const teamUnits = view?.ownUnits ?? [u];
  const max = equipMax(rules, u);
  const canChange = !blocked || isDm;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setError("");
        note.reset();
      } else setError(r.error ?? "That didn't work.");
    });
  const dmNote = isDm ? note.value : undefined;

  const equippable = Object.entries(inventory)
    .filter(
      ([id, q]) =>
        q > 0 &&
        isEquippable(
          rules,
          rules.items.find((x) => x.id === id),
        ),
    )
    .map(([id, q]) => ({
      item: rules.items.find((x) => x.id === id)!,
      qty: q,
      problems: equipProblems(rules, u, id, { inventory, teamUnits, round }),
    }));

  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="text-xs font-medium text-muted">Name</h3>
        <RenameUnit unitId={u.id} name={u.name} placeholder={creature?.statBlock.name ?? "Unit"} />
      </section>

      <section>
        <h3 className="text-xs font-medium text-muted">Archetype</h3>
        {isDm ? (
          <ArchetypePicker unit={u} rules={rules} unitName={unitName} />
        ) : (
          <p>
            {rules.archetypes.find((a) => a.id === u.archetypeId)?.name ?? "none"} <span className="text-xs text-muted">(chosen when it was recruited)</span>
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted">
          Equipped ({u.equippedItemIds.length} of {max})
        </h3>
        {blocked && (
          <p className={`rounded-md border px-2 py-1 text-xs ${isDm ? "border-accent/50" : "border-warn/50 text-warn"}`}>{isDm ? `${blocked} As the DM you can change it anyway.` : blocked}</p>
        )}
        {u.equippedItemIds.length === 0 && <p className="text-muted">Nothing equipped.</p>}
        <ul className="space-y-1">
          {u.equippedItemIds.map((id, i) => {
            const item = rules.items.find((x) => x.id === id);
            const slot = rules.equipSlots.find((s) => s.id === item?.slotId);
            return (
              <li key={`${id}-${i}`} className="flex flex-wrap items-baseline gap-2">
                <strong>{itemName(id)}</strong>
                {slot && <span className="text-xs text-muted">{slot.name}</span>}
                <span className="text-xs text-muted">{item?.effects.map((e) => describeEffect(e, names)).join("; ")}</span>
                <button
                  type="button"
                  className={`${small} ml-auto`}
                  disabled={pending || !canChange}
                  onClick={() =>
                    run(() =>
                      unequipItemAction({
                        unitId: u.id,
                        itemId: id,
                        note: dmNote,
                      }),
                    )
                  }
                >
                  Unequip
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted">Equip from your inventory</h3>
        {equippable.length === 0 && <p className="text-muted">You have nothing that can be equipped.</p>}
        <ul className="space-y-1">
          {equippable.map(({ item, qty, problems }) => {
            const slot = rules.equipSlots.find((s) => s.id === item.slotId);
            const ok = problems.length === 0;
            // The DM can skip the requirements, but still needs the item in the inventory.
            const force = isDm && !ok && qty > 0;
            return (
              <li key={item.id}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{item.name}</strong>
                  <span className="text-xs tabular-nums">×{qty}</span>
                  {slot && <span className="text-xs text-muted">{slot.name}</span>}
                  <span className="text-xs text-muted">{item.effects.map((e) => describeEffect(e, names)).join("; ")}</span>
                  <button
                    type="button"
                    className={`${small} ml-auto`}
                    disabled={pending || !canChange || (!ok && !force)}
                    onClick={() =>
                      run(() =>
                        equipItemAction({
                          unitId: u.id,
                          itemId: item.id,
                          force,
                          note: dmNote,
                        }),
                      )
                    }
                  >
                    {force ? "Equip anyway (DM)" : "Equip"}
                  </button>
                </div>
                {!ok && <p className="text-xs text-warn">{problems.join(" ")}</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">
          Equipping takes the item out of your inventory; unequipping puts it back. Changes happen straight away; change your mind by unequipping or equipping again while the round is open.
          {rules.settings.equipSwapLock && " An item unequipped this round can only go back on the unit it came from until next round."}
        </p>
      </section>

      {isDm && note.ui}
      {pending && <p className="text-xs text-muted">Saving…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** DM only: set or change the unit's archetype. */
function ArchetypePicker({ unit: u, rules, unitName }: { unit: WorldUnit; rules: Ruleset; unitName: string }) {
  const [value, setValue] = useState(u.archetypeId ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const category = rules.creatures.find((c) => c.id === u.creatureId)?.category;
  const chosen = rules.archetypes.find((a) => a.id === value);
  const note = useTeamNote(chosen ? `The DM made ${unitName} a ${chosen.name}.` : `The DM removed ${unitName}'s archetype.`);
  const changed = value !== (u.archetypeId ?? "");
  return (
    <div className="space-y-1">
      <select className="rounded-md border border-border bg-background px-2 py-1 text-sm" aria-label="Archetype" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">— none —</option>
        {rules.archetypes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {category && !a.categories.includes(category) ? ` (not usually for ${category} units)` : ""}
          </option>
        ))}
      </select>
      {changed && (
        <div className="space-y-1 rounded-lg border border-accent/50 p-2">
          {note.ui}
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await dmSetArchetypeAction({
                  unitId: u.id,
                  archetypeId: value || null,
                  note: note.value,
                });
                if (r.ok) {
                  setError("");
                  note.reset();
                } else setError(r.error);
              })
            }
          >
            Change archetype (DM)
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
