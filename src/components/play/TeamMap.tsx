"use client";

import { MapCanvas, type MapNode } from "@/components/map/MapCanvas";
import { DEFAULT_MAP_SIZE } from "@/components/map/mapData";
import { connectionEdges, terrainLayer } from "@/components/map/mapLayers";
import { groupBadges, SpotBadges, type BadgeTeam } from "@/components/map/UnitBadges";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import { ON_MAP_STATUSES } from "@/engine/world/types";

// A team's fogged map. Shows only what's in its view: regions it sees now,
// regions it remembers (dimmed), unexplored neighbours (dashed outline, "?"),
// terrain where it can see, and units where they stand.

type Pt = [number, number];

export interface TeamMapProps {
  view: TeamView;
  rules: Ruleset;
  mapImage: { width: number; height: number; url: string } | null;
  selectedId?: string | null;
  onRegionClick?: (id: string) => void;
  /** Regions to highlight (e.g. where a move can go next). */
  highlight?: Set<string>;
  /** A route to draw: points on the map (fractions), starting where it begins. */
  path?: Pt[];
  /** Any click on the map (not a drag), as a point: for picking a route. */
  onPointClick?: (p: Pt) => void;
  onBackgroundClick?: () => void;
  /** A unit badge was clicked: the region, and the owner (a team ID, or "wild"). */
  onBadgeClick?: (regionId: string, owner: string) => void;
  className?: string;
  bare?: boolean;
  /** Centre the map on this region whenever key changes. */
  focus?: { nodeId: string; key: number } | null;
}

export function TeamMap({ view, rules, mapImage, selectedId, onRegionClick, highlight, path, onPointClick, onBackgroundClick, onBadgeClick, className, bare, focus }: TeamMapProps) {
  const size = mapImage ?? DEFAULT_MAP_SIZE;
  const allTeams = new Map<string, BadgeTeam>([[view.team.id, view.team], ...view.teams.map((t) => [t.id, t] as const)]);
  const byId = new Map(view.regions.map((r) => [r.id, r]));
  const nodes: MapNode[] = view.regions.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    polygon: r.polygon,
    label: r.state === "frontier" ? "?" : r.code,
    fill: r.state === "frontier" ? undefined : r.ownerTeamId ? (allTeams.get(r.ownerTeamId)?.colour ?? "var(--map-unknown-owner)") : undefined,
    stroke: highlight?.has(r.id) ? "var(--map-path)" : undefined,
    ring: Boolean(r.settlementTierId),
    dashed: r.state === "frontier",
    dim: r.state === "remembered",
  }));
  const state = (id: string) => byId.get(id)?.state;
  const edges = connectionEdges(view.connections, (id) => byId.get(id)?.polygon, rules, (c) => ({
    dim: state(c.regionA) === "remembered" || state(c.regionB) === "remembered",
  }));

  const spots = groupBadges(
    [
      ...view.ownUnits.filter((u) => u.regionId && ON_MAP_STATUSES.has(u.status)).map((u) => ({ regionId: u.regionId!, x: u.x, y: u.y, ownerTeamId: view.team.id, dead: u.status === "dead" })),
      ...view.otherUnits.map((u) => ({ regionId: u.regionId, x: u.x, y: u.y, ownerTeamId: u.ownerTeamId, dead: u.dead })),
    ],
    (id) => {
      const r = byId.get(id);
      return r ? [r.x, r.y] : undefined;
    },
    (id) => allTeams.get(id),
  );

  return (
    <MapCanvas
      width={size.width}
      height={size.height}
      imageUrl={mapImage?.url}
      nodes={nodes}
      edges={edges}
      terrain={terrainLayer(view.terrain, rules)}
      selectedNodeId={selectedId}
      onNodeClick={(id, e) => (e.badge && onBadgeClick ? onBadgeClick(id, e.badge) : onRegionClick?.(id))}
      onBackgroundClick={onBackgroundClick && (() => onBackgroundClick())}
      onPointClick={onPointClick}
      className={className}
      bare={bare}
      focus={focus}
      fitToNodes
      overlay={(scale) => (
        <>
          {spots.map((groups) => (
            <SpotBadges key={groups[0].key} groups={groups} width={size.width} height={size.height} scale={scale} ownTeamId={view.team.id} clickable={Boolean(onBadgeClick)} />
          ))}
          {path && path.length > 1 && <RouteLine path={path} width={size.width} height={size.height} scale={scale} />}
        </>
      )}
    />
  );
}

/** A planned route: a line through its points, with the stops numbered. */
export function RouteLine({ path, width, height, scale, colour = "var(--map-path)" }: { path: Pt[]; width: number; height: number; scale: number; colour?: string }) {
  const pts = path.map(([x, y]) => `${x * width},${y * height}`).join(" ");
  return (
    <g pointerEvents="none">
      <polyline points={pts} fill="none" stroke="var(--map-outline)" strokeOpacity={0.6} strokeWidth={6 * scale} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts} fill="none" stroke={colour} strokeWidth={3 * scale} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${8 * scale} ${5 * scale}`} />
      {path.slice(1).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x * width} cy={y * height} r={7 * scale} fill={colour} stroke="var(--map-outline)" strokeWidth={1.5 * scale} />
          <text x={x * width} y={y * height} textAnchor="middle" dominantBaseline="central" fontSize={9 * scale} fontWeight={700} fill="var(--map-outline)">
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}
