"use client";

import type { MapNode } from "@/components/map/MapCanvas";
import { MapSurface } from "@/components/map/MapSurface";
import type { Map3dInfo } from "@/engine/world/mapLook";
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
  /** Own units that can be dragged (their stacks become drag handles). */
  movable?: Set<string>;
  /** A stack (or ghost stack) is being dragged: its units, the pointer, and whether it was let go. */
  onStackDrag?: (unitIds: string[], p: Pt, done: boolean) => void;
  /** Where units will be after their planned moves: drawn as see-through stacks you can drag on from. */
  ghosts?: { id: string; regionId: string; at: Pt }[];
  onGhostClick?: (unitIds: string[]) => void;
  /** Planned moves to draw. */
  routes?: PlannedRoute[];
  onRouteClick?: (id: string) => void;
  /** The move being planned: the line it walks, the rest to where it's aimed (if it stops short), and a label. */
  preview?: { walked: Pt[]; rest: Pt[]; ok: boolean; forced?: boolean; label: string } | null;
  onHover?: (p: Pt | null) => void;
  /** Height map and lighting: offers the 3D view. */
  map3d?: Map3dInfo;
}

export interface PlannedRoute {
  id: string;
  points: Pt[];
  label: string;
  bad?: boolean;
  selected?: boolean;
}

export function TeamMap(props: TeamMapProps) {
  const { view, rules, mapImage, selectedId, onRegionClick, highlight, path, onPointClick, onBackgroundClick, onBadgeClick, className, bare, focus, movable, onStackDrag, ghosts, routes, preview } = props;
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
      ...view.ownUnits.filter((u) => u.regionId && ON_MAP_STATUSES.has(u.status)).map((u) => ({ id: u.id, regionId: u.regionId!, x: u.x, y: u.y, ownerTeamId: view.team.id, dead: u.status === "dead" })),
      ...view.otherUnits.map((u) => ({ regionId: u.regionId, x: u.x, y: u.y, ownerTeamId: u.ownerTeamId, dead: u.dead })),
    ],
    (id) => {
      const r = byId.get(id);
      return r ? [r.x, r.y] : undefined;
    },
    (id) => allTeams.get(id),
  );
  const ghostSpots = groupBadges(
    (ghosts ?? []).map((g) => ({ id: g.id, regionId: g.regionId, x: g.at[0], y: g.at[1], ownerTeamId: view.team.id, dead: false })),
    () => undefined,
    (id) => allTeams.get(id),
  );

  // Drag handles: "stack:<key>" (units that can still move), "ghost:<key>", "route:<id>".
  const stacks = new Map<string, string[]>();
  const stackHandle = (prefix: string) => (g: { key: string; owner: string; ids: string[] }) => {
    if (!onStackDrag || g.owner !== view.team.id) return undefined;
    const ids = prefix === "stack" ? g.ids.filter((id) => movable?.has(id)) : g.ids;
    if (!ids.length) return undefined;
    stacks.set(`${prefix}:${g.key}`, ids);
    return `${prefix}:${g.key}`;
  };
  const ownHandle = stackHandle("stack");
  const ghostHandle = stackHandle("ghost");
  const onHandleMove = (id: string, p: Pt, done: boolean) => {
    const ids = stacks.get(id);
    if (ids) onStackDrag?.(ids, p, done);
  };
  const onHandleClick = (id: string) => {
    const ids = stacks.get(id);
    if (id.startsWith("route:")) props.onRouteClick?.(id.slice(6));
    else if (id.startsWith("ghost:") && ids) props.onGhostClick?.(ids);
    else if (ids) {
      const u = view.ownUnits.find((x) => x.id === ids[0]);
      if (u?.regionId) onBadgeClick?.(u.regionId, view.team.id);
    }
  };

  const size2 = { width: size.width, height: size.height };
  const routeLines = (scale: number) => (
    <>
      {routes?.map((r) => (
        <PlannedLine key={r.id} route={r} {...size2} scale={scale} clickable={Boolean(props.onRouteClick)} />
      ))}
      {path && path.length > 1 && <RouteLine path={path} {...size2} scale={scale} />}
    </>
  );
  // at the origin = for 3D, where each stack stands on the ground as its own little picture.
  const ownBadges = (scale: number, groups: (typeof spots)[number], origin = false) => (
    <SpotBadges key={groups[0].key} groups={groups} {...(origin ? { width: 0, height: 0 } : size2)} scale={scale} ownTeamId={view.team.id} clickable={Boolean(onBadgeClick)} handle={ownHandle} />
  );
  const ghostBadges = (scale: number, groups: (typeof spots)[number], origin = false) => (
    <SpotBadges key={groups[0].key} groups={groups} {...(origin ? { width: 0, height: 0 } : size2)} scale={scale} ownTeamId={view.team.id} handle={ghostHandle} ghost />
  );
  const token = (key: string, at: Pt, badges: React.ReactNode) => ({
    key,
    at,
    content: (
      <svg width={120} height={48} viewBox="-60 -24 120 48" overflow="visible" className="pointer-events-none block">
        {badges}
      </svg>
    ),
  });

  return (
    <MapSurface
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
      onHandleMove={onStackDrag || props.onRouteClick ? onHandleMove : undefined}
      onHandleClick={onStackDrag || props.onRouteClick ? onHandleClick : undefined}
      onHover={props.onHover}
      className={className}
      bare={bare}
      focus={focus}
      fitToNodes
      map3d={props.map3d}
      overlay={(scale) => (
        <>
          {routeLines(scale)}
          {spots.map((groups) => ownBadges(scale, groups))}
          {ghostSpots.map((groups) => ghostBadges(scale, groups))}
          {preview && <PreviewLine preview={preview} {...size2} scale={scale} />}
        </>
      )}
      three={{
        drape: routeLines,
        tokens: [
          ...spots.map((groups) => token(groups[0].key, groups[0].at, ownBadges(1, groups, true))),
          ...ghostSpots.map((groups) => token(`ghost:${groups[0].key}`, groups[0].at, ghostBadges(1, groups, true))),
          ...(preview ? [previewLabel(preview)] : []),
        ],
        lines: preview
          ? [
              { key: "walked", points: preview.walked, colour: preview.forced ? "var(--map-forced)" : preview.ok ? "var(--map-path)" : "var(--danger)", dashed: !preview.forced },
              { key: "rest", points: preview.rest, colour: "var(--danger)", dashed: true },
            ]
          : [],
        hitLines: props.onRouteClick ? routes?.map((r) => ({ handle: `route:${r.id}`, points: r.points })) : undefined,
      }}
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

/** In 3D: the planned move's miles (or why it can't happen), by where it's aimed. */
function previewLabel(preview: NonNullable<TeamMapProps["preview"]>) {
  const tip = preview.rest.length ? preview.rest[preview.rest.length - 1] : preview.walked[preview.walked.length - 1];
  return {
    key: "preview-label",
    at: tip ?? ([0, 0] as Pt),
    content: (
      <span
        className={`pointer-events-none ml-24 block -translate-y-4 rounded-md border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${preview.forced ? "border-[var(--map-forced)] text-[var(--map-forced)]" : preview.ok ? "border-accent text-white" : "border-danger text-danger"}`}
        style={{ background: "var(--map-outline)" }}
      >
        {preview.label}
      </span>
    ),
  };
}

/** A queued move: a solid line with its number by the start; click it to change or cancel it. */
function PlannedLine({ route, width, height, scale, clickable }: { route: PlannedRoute; width: number; height: number; scale: number; clickable: boolean }) {
  if (route.points.length < 2) return null;
  const pts = route.points.map(([x, y]) => `${x * width},${y * height}`).join(" ");
  const colour = route.bad ? "var(--danger)" : "var(--map-path)";
  const [a, b] = route.points;
  const at = { x: (a[0] + (b[0] - a[0]) * 0.5) * width, y: (a[1] + (b[1] - a[1]) * 0.5) * height };
  const end = route.points[route.points.length - 1];
  return (
    <g data-handle={clickable ? `route:${route.id}` : undefined} className={clickable ? "cursor-pointer" : undefined} pointerEvents={clickable ? undefined : "none"}>
      <title>{`Planned move ${route.label}${route.bad ? " (has a problem)" : ""}: click to change or cancel it`}</title>
      {/* A wide invisible line, so the route is easy to click. */}
      <polyline points={pts} fill="none" stroke="transparent" strokeWidth={14 * scale} strokeLinejoin="round" />
      <polyline points={pts} fill="none" stroke="var(--map-outline)" strokeOpacity={0.6} strokeWidth={(route.selected ? 8 : 6) * scale} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts} fill="none" stroke={colour} strokeWidth={(route.selected ? 5 : 3) * scale} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end[0] * width} cy={end[1] * height} r={4 * scale} fill={colour} stroke="var(--map-outline)" strokeWidth={1.5 * scale} />
      <circle cx={at.x} cy={at.y} r={8 * scale} fill={colour} stroke="var(--map-outline)" strokeWidth={1.5 * scale} />
      <text x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central" fontSize={9 * scale} fontWeight={700} fill="var(--map-outline)">
        {route.label}
      </text>
    </g>
  );
}

/** The move being planned: where it gets to, then (red, dashed) the part it can't make. */
function PreviewLine({ preview, width, height, scale }: { preview: NonNullable<TeamMapProps["preview"]>; width: number; height: number; scale: number }) {
  const line = (p: Pt[]) => p.map(([x, y]) => `${x * width},${y * height}`).join(" ");
  const tip = preview.rest.length ? preview.rest[preview.rest.length - 1] : preview.walked[preview.walked.length - 1];
  if (!tip) return null;
  const colour = preview.forced ? "var(--map-forced)" : preview.ok ? "var(--map-path)" : "var(--danger)";
  const fontSize = 12 * scale;
  const w = Math.max(40 * scale, preview.label.length * fontSize * 0.56 + 12 * scale);
  return (
    <g pointerEvents="none">
      {preview.walked.length > 1 && (
        <>
          <polyline points={line(preview.walked)} fill="none" stroke="var(--map-outline)" strokeOpacity={0.6} strokeWidth={6 * scale} strokeLinejoin="round" strokeLinecap="round" />
          {preview.forced ? (
            // A forced march: a solid double line.
            <>
              <polyline points={line(preview.walked)} fill="none" stroke={colour} strokeWidth={6 * scale} strokeLinejoin="round" strokeLinecap="round" />
              <polyline points={line(preview.walked)} fill="none" stroke="var(--map-outline)" strokeWidth={2 * scale} strokeLinejoin="round" strokeLinecap="round" />
            </>
          ) : (
            <polyline points={line(preview.walked)} fill="none" stroke={colour} strokeWidth={3 * scale} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${8 * scale} ${5 * scale}`} />
          )}
        </>
      )}
      {preview.rest.length > 1 && <polyline points={line(preview.rest)} fill="none" stroke="var(--danger)" strokeWidth={2.5 * scale} strokeDasharray={`${4 * scale} ${4 * scale}`} />}
      {preview.walked.slice(1, -1).map(([x, y], i) => (
        <circle key={i} cx={x * width} cy={y * height} r={3.5 * scale} fill={colour} stroke="var(--map-outline)" strokeWidth={1.2 * scale} />
      ))}
      <g transform={`translate(${tip[0] * width + 12 * scale} ${tip[1] * height - 22 * scale})`}>
        <rect width={w} height={20 * scale} rx={6 * scale} fill="var(--map-outline)" fillOpacity={0.85} stroke={colour} strokeWidth={1.5 * scale} />
        <text x={6 * scale} y={14 * scale} fontSize={fontSize} fontWeight={600} fill={preview.forced ? "var(--map-forced)" : preview.ok ? "#fff" : "var(--danger)"}>
          {preview.label}
        </text>
      </g>
    </g>
  );
}
