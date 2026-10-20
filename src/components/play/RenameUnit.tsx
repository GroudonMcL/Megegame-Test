"use client";

import { useState, useTransition } from "react";
import { renameUnitAction } from "@/app/play/actions";
import { useTeamNote } from "@/components/dm/TeamNoteOption";
import { renameNote } from "@/engine/dmEdits";
import { useViewerInfo } from "./viewerInfo";

// Players rename a unit by typing over its name (saved when the field loses
// focus). The DM editing as the team gets a Save button instead, with the
// option to send the team a note about it.

export function RenameUnit({ unitId, name, placeholder }: { unitId: string; name: string; placeholder: string }) {
  const { isDm } = useViewerInfo();
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(name);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const note = useTeamNote(renameNote(saved || placeholder, value.trim()));
  const changed = value.trim() !== saved;
  const save = () => {
    if (!changed) return;
    start(async () => {
      const r = await renameUnitAction(unitId, value, isDm ? note.value : undefined);
      if (r.ok) {
        setSaved(r.value);
        setValue(r.value);
        setError("");
        note.reset();
      } else setError(r.error);
    });
  };
  return (
    <span className="inline-flex flex-col">
      <input
        aria-label="Unit name"
        className="w-56 max-w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base font-medium hover:border-border focus:border-accent focus:outline-none"
        value={value}
        placeholder={placeholder}
        maxLength={60}
        onChange={(e) => setValue(e.target.value)}
        onBlur={isDm ? undefined : save}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (isDm) save();
          else (e.currentTarget as HTMLInputElement).blur();
        }}
      />
      {isDm && changed && (
        <span className="mt-1 flex max-w-sm flex-col gap-1 rounded-lg border border-accent/50 p-2">
          {note.ui}
          <span className="flex gap-2">
            <button type="button" className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50" disabled={pending} onClick={save}>
              Rename (DM)
            </button>
            <button type="button" className="rounded-lg border border-border px-3 py-1 text-sm" onClick={() => setValue(saved)}>
              Cancel
            </button>
          </span>
        </span>
      )}
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
