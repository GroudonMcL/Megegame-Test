import { emblemFor, WILD_EMBLEM } from "@/components/icons/emblems";
import { EmblemGlyph, emblemInk } from "@/components/icons/TeamEmblem";

// Units on the map: one pill per owner at each spot, with the owner's emblem
// and how many units stand there. Units without a position of their own stand
// at their region's centre, so they share a spot.

type Pt = [number, number];

export interface BadgeTeam {
  id: string;
  name: string;
  colour: string;
  emblem?: string | null;
}

export interface BadgeUnit {
  /** For dragging the stack and listing it in the radial menu. */
  id?: string;
  regionId: string;
  /** Null = the region's centre. */
  x: number | null;
  y: number | null;
  /** Null = wild monster. */
  ownerTeamId: string | null;
  dead: boolean;
  /** Stealthed (DM map): drawn with a dashed outline. */
  hidden?: boolean;
  /** Lent to or from the viewer's team (said in the badge's tooltip). */
  lent?: boolean;
}

export interface BadgeGroup {
  key: string;
  /** Every pill at the same spot shares this (one radial menu per spot). */
  spot: string;
  regionId: string;
  at: Pt;
  owner: string;
  team: BadgeTeam | undefined;
  count: number;
  dead: number;
  hidden: number;
  lent: number;
  /** The IDs of the units that have one. */
  ids: string[];
}

/** The key shared by every pill at one spot. */
export function spotOf(regionId: string, at: Pt): string {
  return `${regionId}|${at[0].toFixed(3)}|${at[1].toFixed(3)}`;
}

/** Groups units by spot and owner. centre gives each region's centre. */
export function groupBadges(units: BadgeUnit[], centre: (regionId: string) => Pt | undefined, team: (id: string) => BadgeTeam | undefined): BadgeGroup[][] {
  const spots = new Map<string, BadgeGroup[]>();
  for (const u of units) {
    const c = centre(u.regionId);
    const at: Pt | undefined = u.x !== null && u.y !== null ? [u.x, u.y] : c;
    if (!at) continue;
    const spot = spotOf(u.regionId, at);
    const owner = u.ownerTeamId ?? "wild";
    const list = spots.get(spot) ?? [];
    let g = list.find((x) => x.owner === owner);
    if (!g) list.push((g = { key: `${spot}|${owner}`, spot, regionId: u.regionId, at, owner, team: u.ownerTeamId ? team(u.ownerTeamId) : undefined, count: 0, dead: 0, hidden: 0, lent: 0, ids: [] }));
    g.count++;
    if (u.dead) g.dead++;
    if (u.hidden) g.hidden++;
    if (u.lent) g.lent++;
    if (u.id) g.ids.push(u.id);
    spots.set(spot, list);
  }
  return [...spots.values()];
}

/** A clicked pill's data-badge: who owns its units, and the spot (see SpotBadges). */
export function parseBadge(value: string): { owner: string; spot: string } {
  const at = value.indexOf("@");
  return at < 0 ? { owner: value, spot: "" } : { owner: value.slice(0, at), spot: value.slice(at + 1) };
}

/**
 * The pills for one spot, in a row centred just below it. ownTeamId's pills
 * get square corners. With clickable, each pill carries data-node-id and
 * data-badge ("owner@spot", see parseBadge) so the map reports clicks on it;
 * a pill that handle names gets data-handle instead (it can be dragged). The
 * row carries data-spot, so the radial menu (UnitRadial) can find it on screen
 * in the 2D and the 3D map. ghost = where units will be after their planned
 * moves (dashed, see-through).
 */
export function SpotBadges({
  groups,
  width,
  height,
  scale,
  ownTeamId,
  clickable,
  handle,
  ghost,
}: {
  groups: BadgeGroup[];
  width: number;
  height: number;
  scale: number;
  ownTeamId?: string;
  clickable?: boolean;
  handle?: (g: BadgeGroup) => string | undefined;
  ghost?: boolean;
}) {
  const h = 18 * scale;
  const w = h * 1.9;
  const gap = 3 * scale;
  const [fx, fy] = groups[0].at;
  const px = fx * width;
  const py = fy * height + 12 * scale;
  const total = groups.length * w + (groups.length - 1) * gap;
  return (
    <g data-spot={ghost ? undefined : groups[0].spot}>
      {groups.map((g, i) => {
        const x = px - total / 2 + i * (w + gap);
        const y = py - h / 2;
        const own = g.owner === ownTeamId;
        const colour = g.team?.colour ?? (g.owner === "wild" ? "var(--wild)" : "var(--map-unknown-owner)");
        const label = own ? "of your units" : g.owner === "wild" ? `wild monster${g.count === 1 ? "" : "s"}` : `unit${g.count === 1 ? "" : "s"} of ${g.team?.name ?? "another side"}`;
        return (
          <g
            key={g.key}
            data-handle={handle?.(g)}
            data-node-id={clickable ? g.regionId : undefined}
            data-badge={clickable ? `${g.owner}@${g.spot}` : undefined}
            pointerEvents={clickable || handle?.(g) ? "auto" : "none"}
            className={handle?.(g) ? "cursor-grab" : clickable ? "cursor-pointer" : undefined}
            opacity={ghost ? 0.75 : undefined}
          >
            <title>{ghost ? `${g.count} of your units, after their planned moves (drag to move them on)` : `${g.count} ${label}${g.hidden ? ` (${g.hidden} hidden)` : ""}${g.lent ? ` (${g.lent} lent)` : ""}${handle?.(g) ? " (drag to move)" : ""}`}</title>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={own ? 4 * scale : h / 2}
              fill={colour}
              stroke="var(--map-outline)"
              strokeWidth={1.5 * scale}
              strokeDasharray={g.hidden || ghost ? `${3 * scale} ${2 * scale}` : undefined}
            />
            <EmblemGlyph glyph={g.team ? emblemFor(g.team) : WILD_EMBLEM} x={x + h * 0.55} y={py} size={h * 0.68} fill={g.team ? emblemInk(g.team.colour) : "#ffffff"} />
            <text x={x + w - h * 0.5} y={y + h * 0.7} textAnchor="middle" fontSize={11 * scale} fontWeight={700} fill="var(--map-label)" stroke="var(--map-label-outline)" strokeWidth={2 * scale} paintOrder="stroke">
              {g.dead === g.count ? "✝" : g.count}
            </text>
          </g>
        );
      })}
    </g>
  );
}
