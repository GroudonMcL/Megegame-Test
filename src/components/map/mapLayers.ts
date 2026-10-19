import { sharedBorder } from "@/engine/geo/regions";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { MapEdge } from "./MapCanvas";
import { terrainColour, terrainEffect } from "./terrainStyle";

// What the map draws for connections, shared by the player and DM maps:
//  - a link (regions that don't touch): a curve between their centres;
//  - a blocked border: a dashed wall along the edge the regions share (nothing
//    if they only meet at a corner);
//  - an open border: nothing (the outlines already show it), unless a region
//    has no outline yet, in which case a line between centres as on old maps.

type Pt = [number, number];

interface Conn {
  id: string;
  regionA: string;
  regionB: string;
  kind: string;
  blocked: boolean;
  terrainId: string;
  hidden: boolean;
}

export function connectionEdges(
  connections: Conn[],
  outline: (regionId: string) => Pt[] | undefined,
  rules: Ruleset,
  style: (c: Conn) => Partial<MapEdge> = () => ({}),
): MapEdge[] {
  const out: MapEdge[] = [];
  for (const c of connections) {
    const a = outline(c.regionA);
    const b = outline(c.regionB);
    const shaped = Boolean(a && a.length >= 3 && b && b.length >= 3);
    const terrain = rules.terrainTypes.find((t) => t.id === c.terrainId);
    const base = { id: c.id, a: c.regionA, b: c.regionB, dashed: c.hidden, ...style(c) };
    if (c.kind === "link") {
      out.push({ ...base, curved: true, dashed: true, colour: terrain && terrain.id !== "normal" ? terrainColour(terrain) : base.colour, heavy: c.blocked, ...style(c) });
    } else if (c.blocked) {
      if (!shaped) {
        out.push({ ...base, colour: base.colour ?? "var(--danger)", heavy: true });
        continue;
      }
      const segments = sharedBorder(a!, b!);
      if (segments.length) out.push({ ...base, colour: base.colour ?? "var(--danger)", heavy: true, segments });
    } else if (!shaped) {
      out.push(base);
    }
  }
  return out;
}

/** Terrain areas, coloured by type, for MapCanvas. */
export function terrainLayer(areas: { id: string; terrainId: string; pieces: Pt[][][] }[], rules: Ruleset) {
  return areas.map((a) => {
    const t = rules.terrainTypes.find((x) => x.id === a.terrainId);
    return { id: a.id, pieces: a.pieces, colour: terrainColour(t), title: t?.name ?? a.terrainId, effect: terrainEffect(t) };
  });
}
