"use client";

import { useImperativeHandle, useState, type Ref } from "react";
import { pointInPolygon, type Pt } from "@/engine/geo/polygon";
import type { MapCanvasProps } from "./MapCanvas";

// The note that follows the pointer over a terrain area: its type and what it
// does to movement. It keeps its own state, so moving the pointer only redraws
// the note, not the map.

export interface TerrainTipHandle {
  /** The pointer is at map point p (null = off the map), at this spot in the map's box. */
  show: (p: Pt | null, at: { x: number; y: number }) => void;
}

type Area = NonNullable<MapCanvasProps["terrain"]>[number];

/** The terrain area under p: inside a piece's outline and not in one of its holes. */
export function terrainAt(terrain: Area[], p: Pt): Area | null {
  return terrain.find((t) => t.pieces.some(([outer, ...holes]) => pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h)))) ?? null;
}

export function TerrainTip({ terrain, ref }: { terrain: Area[]; ref: Ref<TerrainTipHandle> }) {
  const [tip, setTip] = useState<{ area: Area; x: number; y: number } | null>(null);
  useImperativeHandle(ref, () => ({
    show: (p, at) => {
      const area = p ? terrainAt(terrain, p) : null;
      setTip((old) => (area ? { area, ...at } : old ? null : old));
    },
  }));
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="glass pointer-events-none absolute z-20 max-w-60 rounded-lg border border-border px-2.5 py-1.5 text-xs shadow"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: tip.area.colour }} aria-hidden />
        {tip.area.title}
      </p>
      {tip.area.effect && <p className="mt-0.5 text-muted">{tip.area.effect}</p>}
    </div>
  );
}
