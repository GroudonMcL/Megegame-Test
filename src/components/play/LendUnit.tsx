"use client";

import { useState, useTransition } from "react";
import { lendUnitAction } from "@/app/play/actions";
import { useTeamNote } from "@/components/dm/TeamNoteOption";
import { TeamEmblem, type EmblemTeam } from "@/components/icons/TeamEmblem";
import { useViewerInfo } from "./viewerInfo";

// "Lend to…" on one of the team's units: let a team it has met move the unit
// (both teams can, until it's taken back), or take it back. The DM editing as
// the team gets the note option.

/** borrower: the team it's lent to now, if any (lentToTeamId alone if the team isn't known here). */
export function LendUnit({ unitId, lentToTeamId, borrower, unitName }: { unitId: string; lentToTeamId: string | null; borrower?: EmblemTeam | null; unitName: string }) {
  const { isDm, contacts = [] } = useViewerInfo();
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const target = contacts.find((t) => t.id === to);
  const note = useTeamNote(lentToTeamId ? `The DM took back ${unitName} from ${borrower?.name ?? "the team it was lent to"} for you.` : `The DM lent ${unitName} to ${target?.name ?? "another faction"} for you.`);
  const run = (team: string | null) =>
    start(async () => {
      const r = await lendUnitAction(unitId, team, isDm ? note.value : undefined);
      if (r.ok) {
        setError("");
        setTo("");
        note.reset();
      } else setError(r.error);
    });

  if (lentToTeamId) {
    return (
      <div className="mt-2 space-y-1 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <TeamEmblem team={borrower ?? null} size={16} />
          <span>
            Lent to <strong>{borrower?.name ?? "another faction"}</strong>: you both can move it.
          </span>
          <button type="button" className="rounded-md border border-border px-2 py-0.5 text-xs hover:border-border-strong disabled:opacity-50" disabled={pending} onClick={() => run(null)}>
            Take back
          </button>
        </p>
        {isDm && note.ui}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }

  if (!contacts.length) return null;
  return (
    <div className="mt-2 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-muted">Lend to…</span>
          <select className="rounded-md border border-border bg-background px-2 py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">choose a faction</option>
            {contacts.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground disabled:opacity-50" disabled={!to || pending} onClick={() => run(to)}>
          Lend
        </button>
      </div>
      {to && <p className="text-xs text-muted">{target?.name} will be able to move this unit and see what it sees. You can still move it, and take it back at any time.</p>}
      {isDm && to && note.ui}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
