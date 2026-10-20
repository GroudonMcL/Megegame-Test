"use client";

import { useState, useTransition } from "react";
import { dmUndoAction } from "@/app/play/actions";
import type { DmChangeView } from "@/lib/dmEdits";
import { NO_NOTE, noteFor, TeamNoteOption } from "./TeamNoteOption";

// The DM's changes to one team, each with Undo (and the option to tell the team).

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" });

export function DmChangeList({ changes }: { changes: DmChangeView[] }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [noteState, setNoteState] = useState(NO_NOTE);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!changes.length) return <p className="mt-3 text-sm text-muted">You haven&apos;t changed anything for this team yet.</p>;

  const undo = (c: DmChangeView) =>
    start(async () => {
      const r = await dmUndoAction(c.id, noteFor(noteState, suggest(c)));
      setStatus(r.ok ? { ok: true, text: `Undone: ${c.description}` } : { ok: false, text: r.error });
      if (r.ok) setConfirm(null);
    });

  return (
    <>
      {status && (
        <p role="status" className={`mt-3 text-sm ${status.ok ? "text-ok" : "text-danger"}`}>
          {status.text}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {changes.map((c) => (
          <li key={c.id} className={`rounded-lg border border-border p-3 text-sm ${c.undone ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={c.undone ? "line-through" : ""}>{c.description}</span>
              <span className="text-xs text-muted">{when(c.createdAt)}</span>
              {c.undone ? (
                <span className="ml-auto text-xs text-muted">undone</span>
              ) : (
                <button
                  type="button"
                  className="ml-auto rounded-lg border border-border px-3 py-1 text-sm disabled:opacity-50"
                  disabled={pending}
                  onClick={() => {
                    setNoteState(NO_NOTE);
                    setConfirm(confirm === c.id ? null : c.id);
                  }}
                >
                  Undo…
                </button>
              )}
            </div>
            {confirm === c.id && (
              <div className="mt-2 space-y-2 rounded-lg border border-accent/50 p-2">
                <TeamNoteOption suggested={suggest(c)} value={noteState} onChange={setNoteState} />
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50" disabled={pending} onClick={() => undo(c)}>
                    Undo this change
                  </button>
                  <button type="button" className="rounded-lg border border-border px-3 py-1 text-sm" onClick={() => setConfirm(null)}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

const suggest = (c: DmChangeView) => `The DM took back an earlier change: ${c.description}.`;
