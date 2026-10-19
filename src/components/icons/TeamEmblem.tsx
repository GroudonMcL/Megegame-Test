import { parseColour, textOn, toHex } from "@/components/theme/contrast";
import { emblemFor, WILD_EMBLEM, type Glyph } from "./emblems";

// A team's badge: its emblem in a disc of its colour. Shape + colour, so teams
// can be told apart without seeing colour.

/** Black or white, for drawing an emblem on top of a team colour. */
export function emblemInk(colour: string) {
  try {
    return toHex(textOn(parseColour(colour).rgb));
  } catch {
    return "#ffffff";
  }
}

export interface EmblemTeam {
  id: string;
  name: string;
  colour: string;
  emblem?: string | null;
}

/** The emblem disc as HTML. Pass team = null for wild monsters. */
export function TeamEmblem({ team, size = 20, className = "", title }: { team: EmblemTeam | null; size?: number; className?: string; title?: string }) {
  const glyph = team ? emblemFor(team) : WILD_EMBLEM;
  const colour = team ? team.colour : "var(--wild)";
  const label = title ?? (team ? `${team.name} (${glyph.label})` : "Wild");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} className={`inline-block shrink-0 ${className}`}>
      <title>{label}</title>
      <circle cx={12} cy={12} r={11.5} fill={colour} stroke="var(--map-outline)" strokeOpacity={0.5} strokeWidth={1} />
      <EmblemGlyph glyph={glyph} x={12} y={12} size={14} fill={team ? emblemInk(team.colour) : "#ffffff"} />
    </svg>
  );
}

/** Just the emblem shape, centred on (x, y), for drawing inside an SVG (the map). */
export function EmblemGlyph({ glyph, x, y, size, fill }: { glyph: Glyph; x: number; y: number; size: number; fill: string }) {
  const s = size / 24;
  return <path d={glyph.d} fillRule={glyph.evenOdd ? "evenodd" : undefined} fill={fill} transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})`} />;
}
