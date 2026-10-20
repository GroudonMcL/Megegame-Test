"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import type { Map3dInfo } from "@/engine/world/mapLook";
import { MapCanvas, type MapCanvasProps } from "./MapCanvas";
import type { Map3DExtras } from "./Map3D";
import { TerrainTip, type TerrainTipHandle } from "./TerrainTip";
import { hasWebGL } from "./three/mapTexture";

// A map that can be shown flat (2D, the default) or as 3D terrain. The choice
// is remembered on this device. 3D is loaded only when it's turned on, and it
// turns itself off (and remembers why) if the device has no WebGL or draws it
// too slowly. Both take the same props and report the same clicks and drags.

export const Map3D = dynamic(() => import("./Map3D"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading 3D map…</div>,
});

const MODE_KEY = "megagame.map.mode";
const SLOW_KEY = "megagame.map.3dSlow";
const TERRAIN_KEY = "megagame.map.terrain";

const listeners = new Set<() => void>();
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse; the choice just isn't remembered.
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

let webgl: boolean | null = null;
const webglOk = () => (webgl ??= hasWebGL());

/** Can this browser draw 3D? (False while rendering on the server.) */
export function useWebGL() {
  return useSyncExternalStore(subscribe, webglOk, () => false);
}

/** Night: a dark wash over the 2D map, as strong as the DM's darkness setting. */
export function nightTint(map3d: Map3dInfo | undefined) {
  const d = map3d?.look.darkness ?? 0;
  return d > 0 ? `rgba(4, 8, 22, ${(0.65 * d).toFixed(3)})` : null;
}

export function MapSurface({ map3d, three, ...props }: MapCanvasProps & { map3d?: Map3dInfo; three?: Map3DExtras }) {
  const mode = useSyncExternalStore(subscribe, () => read(MODE_KEY), () => null);
  const slow = useSyncExternalStore(subscribe, () => read(SLOW_KEY), () => null);
  const [note, setNote] = useState<string | null>(null);
  // Terrain areas can be hidden (remembered on this device); hovering one shows what it is.
  const hideTerrain = useSyncExternalStore(subscribe, () => read(TERRAIN_KEY) === "hidden", () => false);
  const terrain = hideTerrain ? undefined : props.terrain;
  const tip = useRef<TerrainTipHandle>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const onHover = (p: [number, number] | null) => {
    props.onHover?.(p);
    tip.current?.show(p, pointer.current);
  };
  const canDraw3d = useWebGL();
  const is3d = Boolean(map3d) && mode === "3d" && !slow && canDraw3d;

  const choose = (to: "2d" | "3d") => {
    setNote(null);
    if (to === "3d" && !webglOk()) {
      setNote("3D needs WebGL, which this browser doesn't have.");
      return;
    }
    if (to === "3d") write(SLOW_KEY, null);
    write(MODE_KEY, to);
  };

  return (
    <div
      className={`relative ${props.className ?? "h-[70vh]"}`}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - box.left, y: e.clientY - box.top };
      }}
      onPointerLeave={() => tip.current?.show(null, pointer.current)}
    >
      {is3d && map3d ? (
        <Map3D
          {...props}
          {...three}
          terrain={terrain}
          onHover={onHover}
          className="h-full"
          heightUrl={map3d.heightUrl}
          look={map3d.look}
          onSlow={() => {
            write(SLOW_KEY, "1");
            setNote("3D was running slowly on this device, so the map is back in 2D. You can try 3D again.");
          }}
        />
      ) : (
        <MapCanvas {...props} terrain={terrain} onHover={onHover} className="h-full" tint={props.tint ?? nightTint(map3d)} />
      )}
      {terrain && terrain.length > 0 && <TerrainTip ref={tip} terrain={terrain} />}
      {(Boolean(map3d) || Boolean(props.terrain?.length)) && (
        <div className="absolute right-2 bottom-11 flex flex-col items-end gap-1">
          {note && (
            <p role="status" className="glass max-w-64 rounded-lg border border-border px-2.5 py-1.5 text-xs shadow">
              {note}
            </p>
          )}
          {props.terrain && props.terrain.length > 0 && (
            <button
              type="button"
              aria-pressed={!hideTerrain}
              className={`glass rounded-lg border border-border px-2.5 py-1 text-xs shadow ${hideTerrain ? "hover:bg-raised" : "bg-raised font-medium"}`}
              onClick={() => write(TERRAIN_KEY, hideTerrain ? null : "hidden")}
              title="Show or hide terrain areas (hover one to see what it does)"
            >
              Terrain: {hideTerrain ? "hidden" : "shown"}
            </button>
          )}
          {map3d && (
            <div className="glass flex overflow-hidden rounded-lg border border-border text-xs shadow" role="group" aria-label="Map view">
              {(["2d", "3d"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={(m === "3d") === is3d}
                  className={`px-2.5 py-1 ${(m === "3d") === is3d ? "bg-accent text-accent-foreground" : "hover:bg-raised"}`}
                  onClick={() => choose(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
