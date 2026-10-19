"use client";

import { MapCanvas, type MapEdge, type MapNode } from "@/components/map/MapCanvas";
import { DEFAULT_MAP_SIZE } from "@/components/map/mapData";
import { emblemFor, WILD_EMBLEM, type Glyph } from "@/components/icons/emblems";
import { EmblemGlyph, emblemInk } from "@/components/icons/TeamEmblem";
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
  const allTeams = new Map([[view.team.id, view.team], ...view.teams.map((t) => [t.id, t] as const)]);
  const colour = new Map([...allTeams].map(([id, t]) => [id, t.colour]));
  const nodes: MapNode[] = view.regions.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    label: r.state === "frontier" ? "?" : r.code,
    fill: r.state === "frontier" ? "var(--map-frontier)" : r.ownerTeamId ? colour.get(r.ownerTeamId) ?? "var(--map-unknown-owner)" : "var(--map-region)",
    stroke: highlight?.has(r.id) ? "var(--map-path)" : undefined,
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
      colour: onPath ? "var(--map-path)" : terrain && terrain.requiresMovement.length ? "var(--map-water)" : undefined,
      dashed: state.get(c.regionA) === "frontier" || state.get(c.regionB) === "frontier",
      dim: state.get(c.regionA) === "remembered" || state.get(c.regionB) === "remembered",
    };
  });

  // One badge per owner in each region: the owner's emblem and how many units.
  const badges = new Map<string, { owner: string; colour: string; ink: string; glyph: Glyph; count: number; own: boolean; dead: number }[]>();
  const add = (regionId: string, ownerId: string | null, own: boolean, dead: boolean) => {
    const list = badges.get(regionId) ?? [];
    const owner = ownerId ?? "wild";
    let b = list.find((x) => x.owner === owner);
    if (!b) {
      const t = ownerId ? allTeams.get(ownerId) : undefined;
      const c = t ? t.colour : ownerId ? "var(--map-unknown-owner)" : WILD_COLOUR;
      list.push((b = { owner, colour: c, ink: t ? emblemInk(t.colour) : "#ffffff", glyph: t ? emblemFor(t) : WILD_EMBLEM, count: 0, own, dead: 0 }));
    }
    b.count++;
    if (dead) b.dead++;
    badges.set(regionId, list);
  };
  for (const u of view.ownUnits) if (u.regionId && ON_MAP_STATUSES.has(u.status)) add(u.regionId, view.team.id, true, u.status === "dead");
  for (const u of view.otherUnits) add(u.regionId, u.ownerTeamId, false, u.dead);

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
              // A pill: emblem on the left, count on the right. Own units get square corners.
              const h = 18 * scale;
              const w = h * 1.9;
              const x = p.x + 12 * scale + i * (w + 3 * scale);
              const y = p.y - h / 2;
              return (
                <g key={b.owner}>
                  <rect x={x} y={y} width={w} height={h} rx={b.own ? 4 * scale : h / 2} fill={b.colour} stroke="var(--map-outline)" strokeWidth={1.5 * scale} />
                  <EmblemGlyph glyph={b.glyph} x={x + h * 0.55} y={p.y} size={h * 0.68} fill={b.ink} />
                  <text x={x + w - h * 0.5} y={y + h * 0.7} textAnchor="middle" fontSize={11 * scale} fontWeight={700} fill="var(--map-label)" stroke="var(--map-label-outline)" strokeWidth={2 * scale} paintOrder="stroke">
                    {b.dead === b.count ? "✝" : b.count}
                  </text>
                </g>
              );
            })}
            {stepIndex > 0 && (
              <text x={p.x} y={p.y + 4 * scale} textAnchor="middle" fontSize={11 * scale} fontWeight={700} fill="var(--map-outline)">
                {stepIndex}
              </text>
            )}
          </g>
        );
      }}
    />
  );
}
