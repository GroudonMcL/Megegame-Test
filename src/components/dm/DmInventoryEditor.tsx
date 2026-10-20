"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dmEditInventoryAction, dmEditRecipesAction } from "@/app/play/actions";
import { inventoryNote, MAX_ITEM_QTY, planInventoryEdit, planRecipeEdit, recipeNote } from "@/engine/dmEdits";
import { useTeamNote } from "./TeamNoteOption";

// The DM's extra controls on a team's Inventory window (view as team): set
// item quantities, add or remove items, and teach or forget recipes. Each
// save is one change in the DM's change list (undoable), with an optional
// note to the team. They show the live game, even while players still see
// the start-of-round picture during resolution.

type Option = { id: string; name: string };
const field = "rounded-md border border-border bg-background px-2 py-1 text-sm";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50";

export function DmInventoryEditor({ items, inventory }: { items: Option[]; inventory: Record<string, number> }) {
  const router = useRouter();
  const [wanted, setWanted] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const change = planInventoryEdit(inventory, wanted);
  const note = useTeamNote(change ? inventoryNote(change, name) : "");
  // Owned items, then ones being added.
  const shown = [...new Set([...Object.keys(inventory).filter((id) => inventory[id] > 0), ...Object.keys(wanted)])];
  const qty = (id: string) => wanted[id] ?? inventory[id] ?? 0;
  const set = (id: string, v: number) => setWanted((w) => ({ ...w, [id]: Math.max(0, Math.min(MAX_ITEM_QTY, Math.floor(v) || 0)) }));

  const save = () =>
    start(async () => {
      const r = await dmEditInventoryAction({ items: wanted, note: note.value });
      if (r.ok) {
        setWanted({});
        note.reset();
        setStatus({ ok: true, text: "Saved. It's in DM changes if you need to undo it." });
        router.refresh();
      } else setStatus({ ok: false, text: r.error });
    });

  return (
    <div className="space-y-3 text-sm">
      {shown.length === 0 && <p className="text-muted">No items. Add one below.</p>}
      <ul className="space-y-1">
        {shown.map((id) => {
          const was = inventory[id] ?? 0;
          const now = qty(id);
          return (
            <li key={id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-40 flex-1">{name(id)}</span>
              <input type="number" min={0} max={MAX_ITEM_QTY} aria-label={`${name(id)} quantity`} className={`${field} w-24`} value={now} onChange={(e) => set(id, Number(e.target.value))} />
              <button type="button" className="rounded-md border border-border px-2 py-1 text-xs" onClick={() => set(id, 0)} disabled={now === 0}>
                Remove
              </button>
              {now !== was && <span className={`text-xs ${now > was ? "text-ok" : "text-danger"}`}>{now > was ? `+${now - was}` : now - was}</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Item to add" className={`${field} min-w-48 flex-1`} value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add an item…</option>
          {items
            .filter((i) => !shown.includes(i.id))
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
          disabled={!adding}
          onClick={() => {
            set(adding, 1);
            setAdding("");
          }}
        >
          Add
        </button>
      </div>
      {change && note.ui}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={pending || !change} onClick={save}>
          Save items (DM)
        </button>
        {change && (
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setWanted({})}>
            Reset
          </button>
        )}
        {status && (
          <span role="status" className={status.ok ? "text-ok" : "text-danger"}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function DmRecipeEditor({ recipes, known }: { recipes: (Option & { atStart: boolean })[]; known: string[] }) {
  const router = useRouter();
  const [wanted, setWanted] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const atStart = new Set(recipes.filter((r) => r.atStart).map((r) => r.id));
  const change = planRecipeEdit(known, wanted, atStart);
  const name = (id: string) => recipes.find((r) => r.id === id)?.name ?? id;
  const note = useTeamNote(change ? recipeNote(change, name) : "");
  const isKnown = (id: string) => atStart.has(id) || (wanted[id] ?? known.includes(id));

  const save = () =>
    start(async () => {
      const r = await dmEditRecipesAction({ recipes: wanted, note: note.value });
      if (r.ok) {
        setWanted({});
        note.reset();
        setStatus({ ok: true, text: "Saved. It's in DM changes if you need to undo it." });
        router.refresh();
      } else setStatus({ ok: false, text: r.error });
    });

  if (!recipes.length) return <p className="text-sm text-muted">The ruleset has no recipes.</p>;
  return (
    <div className="space-y-3 text-sm">
      <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
        {recipes.map((r) => (
          <li key={r.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isKnown(r.id)} disabled={r.atStart} onChange={(e) => setWanted((w) => ({ ...w, [r.id]: e.target.checked }))} />
              {r.name}
              {r.atStart && <span className="text-xs text-muted">(everyone knows this from the start)</span>}
              {!r.atStart && change && r.id in change.after && <span className="text-xs text-link">{change.after[r.id] ? "teach" : "forget"}</span>}
            </label>
          </li>
        ))}
      </ul>
      {change && note.ui}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={pending || !change} onClick={save}>
          Save recipes (DM)
        </button>
        {status && (
          <span role="status" className={status.ok ? "text-ok" : "text-danger"}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
