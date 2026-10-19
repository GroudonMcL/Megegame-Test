"use client";

import { MapCanvas, type MapEdge, type MapNode } from "@/components/map/MapCanvas";
import { DEFAULT_MAP_SIZE } from "@/components/map/mapData";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import { ON_MAP_STATUSES } from "@/engine/world/types";
import { WILD_COLOUR } from "./format";

// A team's fogged map. Shows only what's in its view: regions it sees now,
// regions it remembers (dimmed) and unexplored neighbours (dashed "?").

export interface TeamMapProps {
  view: TeamView;
  rules: Ruleset;
  mapImage: { width: number; height: number; url: string } | null;
  selectedId?: string | null;
  onRegionClick?: (id: string) => void;
  /** Regions to highlight (e.g. reachable by a move). */
  highlight?: Set<string>;
  /** A path to draw, as region IDs, starting with where it begins. */
  path?: string[];
  className?: string;
}

export function TeamMap({ view, rules, mapImage, selectedId, onRegionClick, highlight, path, className }: TeamMapProps) {
  const size = mapImage ?? DEFAULT_MAP_SIZE;
  const colour = new Map([[view.team.id, view.team.colour], ...view.teams.map((t) => [t.id, t.colour] as const)]);
  const nodes: MapNode[] = view.regions.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    label: r.state === "frontier" ? "?" : r.code,
    fill: r.state === "frontier" ? "#64748b" : r.ownerTeamId ? colour.get(r.ownerTeamId) ?? "#94a3b8" : "#e2e8f0",
    stroke: highlight?.has(r.id) ? "#22c55e" : undefined,
    ring: Boolean(r.settlementTierId),
    dashed: r.state === "frontier",
    dim: r.state === "remembered",
  }));
  const state = new Map(view.regions.map((r) => [r.id, r.state]));
  const pathEdges = new Set<string>();
  if (path) for (let i = 1; i < path.length; i++) pathEdges.add([path[i - 1], path[i]].sort().join("|"));
  const edges: MapEdge[] = view.connections.map((c) => {
    const terrain = rules.terrainTypes.find((t) => t.id === c.terrainId);
    const onPath = pathEdges.has([c.regionA, c.regionB].sort().join("|"));
    return {
      id: c.id,
      a: c.regionA,
      b: c.regionB,
      heavy: onPath || (terrain ? terrain.costMultiplier > 1 || terrain.requiresMovement.length > 0 : false),
      colour: onPath ? "#22c55e" : terrain && terrain.requiresMovement.length ? "#38bdf8" : undefined,
      dashed: state.get(c.regionA) === "frontier" || state.get(c.regionB) === "frontier",
      dim: state.get(c.regionA) === "remembered" || state.get(c.regionB) === "remembered",
    };
  });

  const badges = new Map<string, { colour: string; count: number; own: boolean; dead: number }[]>();
  const add = (regionId: string, c: string, own: boolean, dead: boolean) => {
    const list = badges.get(regionId) ?? [];
    let b = list.find((x) => x.colour === c && x.own === own);
    if (!b) list.push((b = { colour: c, count: 0, own, dead: 0 }));
    b.count++;
    if (dead) b.dead++;
    badges.set(regionId, list);
  };
  for (const u of view.ownUnits) if (u.regionId && ON_MAP_STATUSES.has(u.status)) add(u.regionId, view.team.colour, true, u.status === "dead");
  for (const u of view.otherUnits) add(u.regionId, u.ownerTeamId ? colour.get(u.ownerTeamId) ?? "#94a3b8" : WILD_COLOUR, false, u.dead);

  return (
    <MapCanvas
      width={size.width}
      height={size.height}
      imageUrl={mapImage?.url}
      nodes={nodes}
      edges={edges}
      selectedNodeId={selectedId}
      onNodeClick={(id) => onRegionClick?.(id)}
      className={className}
      fitToNodes
      renderNodeExtras={(n, p, scale) => {
        const list = badges.get(n.id) ?? [];
        const stepIndex = path ? path.indexOf(n.id) : -1;
        return (
          <g pointerEvents="none">
            {list.map((b, i) => {
              const w = 18 * scale;
              const x = p.x + 12 * scale + i * (w + 2 * scale);
              const y = p.y - w / 2;
              return (
                <g key={i}>
                  <rect x={x} y={y} width={w} height={w} rx={b.own ? 3 * scale : w / 2} fill={b.colour} stroke="#000" strokeWidth={1.5 * scale} />
                  <text x={x + w / 2} y={y + w * 0.7} textAnchor="middle" fontSize={11 * scale} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={2 * scale} paintOrder="stroke">
                    {b.dead === b.count ? "✝" : b.count}
                  </text>
                </g>
              );
            })}
            {stepIndex > 0 && (
              <text x={p.x} y={p.y + 4 * scale} textAnchor="middle" fontSize={11 * scale} fontWeight={700} fill="#000">
                {stepIndex}
              </text>
            )}
          </g>
        );
      }}
    />
  );
}
