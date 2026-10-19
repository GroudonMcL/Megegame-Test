"use client";

import { useState, useTransition } from "react";
import { updateTeamAction } from "./teams";

// "Edit team" on the Teams page: everything about a team the DM may change by hand.

interface Props {
  gameId: string;
  team: {
    id: string;
    name: string;
    colour: string;
    isNpc: boolean;
    baseRaceId: string | null;
    raceIds: string[];
    resources: Record<string, number>;
    secretObjectives: string;
    notes: string;
  };
  races: { id: string; name: string }[];
  resources: { id: string; name: string; icon: string }[];
}

const box = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

export function TeamEditor({ gameId, team, races, resources }: Props) {
  const [t, setT] = useState(team);
  // Start again from the saved values whenever they change (after a save, or a round being published).
  const [seen, setSeen] = useState(JSON.stringify(team));
  if (seen !== JSON.stringify(team)) {
    setSeen(JSON.stringify(team));
    setT(team);
  }
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const save = () =>
    start(async () => {
      const r = await updateTeamAction(gameId, team.id, t);
      setMessage(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    });

  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-accent">Edit team</summary>
      <div className="mt-2 grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1">
            <span className="text-xs text-muted">Name</span>
            <input className={box} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          </label>
          <label>
            <span className="block text-xs text-muted">Colour</span>
            <input type="color" className="h-9 w-14 rounded-md border border-border bg-background" value={t.colour} onChange={(e) => setT({ ...t, colour: e.target.value })} />
          </label>
          <label className="flex items-center gap-1 pb-2" title="A faction the DM plays. It isn't counted as waiting for orders.">
            <input type="checkbox" checked={t.isNpc} onChange={(e) => setT({ ...t, isNpc: e.target.checked })} /> DM-run (NPC)
          </label>
        </div>
        {races.length > 0 && (
          <>
            <label>
              <span className="text-xs text-muted">Base race (the one it starts with and can never trade away)</span>
              <select className={box} value={t.baseRaceId ?? ""} onChange={(e) => setT({ ...t, baseRaceId: e.target.value || null })}>
                <option value="">None</option>
                {races.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="text-xs text-muted">Other races it can recruit</legend>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {races
                  .filter((r) => r.id !== t.baseRaceId)
                  .map((r) => (
                    <label key={r.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={t.raceIds.includes(r.id)}
                        onChange={(e) => setT({ ...t, raceIds: e.target.checked ? [...t.raceIds, r.id] : t.raceIds.filter((x) => x !== r.id) })}
                      />
                      {r.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          </>
        )}
        <fieldset>
          <legend className="text-xs text-muted">Resources</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {resources.map((r) => (
              <label key={r.id} className="flex items-center gap-1">
                <span>
                  {r.icon} {r.name}
                </span>
                <input
                  type="number"
                  className="w-20 rounded-md border border-border bg-background px-1 py-1"
                  value={t.resources[r.id] ?? 0}
                  onChange={(e) => setT({ ...t, resources: { ...t.resources, [r.id]: Number(e.target.value) || 0 } })}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <span className="text-xs text-muted">Secret objectives (only this team sees them, on its dashboard)</span>
          <textarea className={box} rows={3} value={t.secretObjectives} onChange={(e) => setT({ ...t, secretObjectives: e.target.value })} />
        </label>
        <label>
          <span className="text-xs text-muted">DM notes (never shown to players)</span>
          <textarea className={box} rows={2} value={t.notes} onChange={(e) => setT({ ...t, notes: e.target.value })} />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save team"}
          </button>
          {message && (
            <span role="status" className={message.ok ? "text-ok" : "text-danger"}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
