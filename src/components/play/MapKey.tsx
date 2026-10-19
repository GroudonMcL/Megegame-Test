"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import type { TeamView } from "@/engine/world/teamView";

// The map's key, folded away in the corner until asked for.

export function MapKey({ view }: { view: TeamView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[min(22rem,calc(100%-1.5rem))]">
      {open && (
        <div className="glass mb-2 rounded-xl border border-border p-3 text-xs shadow-panel">
          <ul className="space-y-1">
            <li className="flex items-center gap-1.5">
              <TeamEmblem team={view.team} size={16} /> Your units (square badges)
            </li>
            {view.teams.map((t) => (
              <li key={t.id} className="flex items-center gap-1.5">
                <TeamEmblem team={t} size={16} /> {t.name}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <TeamEmblem team={null} size={16} /> Wild monsters
            </li>
          </ul>
          <p className="mt-2 text-muted">Ring = settlement · faded = seen before · ? = unexplored · thick line = hard going · blue line = needs swimming or flying</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="glass flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium shadow hover:border-border-strong"
      >
        <Icon name="info" size={14} /> {open ? "Hide key" : "Map key"}
      </button>
    </div>
  );
}
