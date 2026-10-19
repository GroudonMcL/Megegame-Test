"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import type { Map3dInfo } from "@/engine/world/mapLook";
import { MapCanvas, type MapCanvasProps } from "./MapCanvas";
import type { Map3DExtras } from "./Map3D";
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
    <div className={`relative ${props.className ?? "h-[70vh]"}`}>
      {is3d && map3d ? (
        <Map3D
          {...props}
          {...three}
          className="h-full"
          heightUrl={map3d.heightUrl}
          look={map3d.look}
          onSlow={() => {
            write(SLOW_KEY, "1");
            setNote("3D was running slowly on this device, so the map is back in 2D. You can try 3D again.");
          }}
        />
      ) : (
        <MapCanvas {...props} className="h-full" tint={props.tint ?? nightTint(map3d)} />
      )}
      {map3d && (
        <div className="absolute right-2 bottom-11 flex flex-col items-end gap-1">
          {note && (
            <p role="status" className="glass max-w-64 rounded-lg border border-border px-2.5 py-1.5 text-xs shadow">
              {note}
            </p>
          )}
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
        </div>
      )}
    </div>
  );
}
