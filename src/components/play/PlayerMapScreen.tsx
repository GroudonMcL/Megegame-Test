"use client";

import { useState } from "react";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import { RegionDetails } from "./RegionDetails";
import { WILD_COLOUR } from "./format";
import { TeamMap } from "./TeamMap";

export function PlayerMapScreen({ view, rules, mapImage }: { view: TeamView; rules: Ruleset; mapImage: { width: number; height: number; url: string } | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const region = view.regions.find((r) => r.id === selected);
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-2">
        <TeamMap view={view} rules={rules} mapImage={mapImage} selectedId={selected} onRegionClick={setSelected} className="h-[60vh] lg:h-[72vh]" />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm" style={{ background: view.team.colour }} /> your units
          </span>
          {view.teams.map((t) => (
            <span key={t.id} className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full" style={{ background: t.colour }} /> {t.name}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-full" style={{ background: WILD_COLOUR }} /> wild
          </span>
          <span>· ring = settlement · faded = seen before · ? = unexplored · thick line = hard going</span>
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        {region ? <RegionDetails region={region} view={view} rules={rules} /> : <p className="text-sm text-muted">Tap a region to see what you know about it.</p>}
      </div>
    </div>
  );
}
