"use client";

import { useRef, useState, useTransition } from "react";
import { removeHeightMapAction, saveMapLookAction, uploadHeightMapAction } from "@/app/dm/games/[gameId]/map/actions";
import { DEFAULT_MAP_LOOK, type MapLook } from "@/engine/world/mapLook";

// The map editor's "3D & light" panel: the height map, how tall it's drawn,
// and the lighting (a sun with a colour and position, light from the sky, and
// darkness for night). Changes show in the preview at once; Save makes them
// what everyone sees.

const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50";

export function LookPanel({
  gameId,
  look,
  saved,
  onChange,
  onSaved,
  heightUrl,
  onHeight,
}: {
  gameId: string;
  look: MapLook;
  /** The look as last saved, to tell whether there are changes. */
  saved: MapLook;
  onChange: (look: MapLook) => void;
  onSaved: (look: MapLook) => void;
  heightUrl: string | null;
  onHeight: (url: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof MapLook>(key: K, value: MapLook[K]) => onChange({ ...look, [key]: value });
  const dirty = JSON.stringify(look) !== JSON.stringify(saved);

  const upload = (file: File) =>
    startTransition(async () => {
      setMessage({ ok: true, text: "Uploading the height map…" });
      const form = new FormData();
      form.set("image", file, "height");
      const r = await uploadHeightMapAction(gameId, form);
      if (r.ok) {
        onHeight(`/api/assets/${r.value.id}`);
        setMessage({ ok: true, text: "Height map uploaded." });
      } else setMessage({ ok: false, text: r.error });
    });

  const slider = (key: "relief" | "sunBearing" | "sunElevation" | "sunIntensity" | "ambientIntensity" | "darkness", label: string, min: number, max: number, step: number, show: (v: number) => string) => (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{show(look[key])}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={look[key]} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </label>
  );
  const colour = (key: "sunColour" | "ambientColour", label: string) => (
    <label className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <input type="color" value={look[key]} onChange={(e) => set(key, e.target.value)} className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent" />
    </label>
  );

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="font-semibold">Height map</h3>
        <p className="text-sm text-muted">
          A greyscale picture the same shape as the map: white is the highest ground, black the lowest. Players only get the heights of regions they have seen; the rest of their map is flat.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => fileRef.current?.click()} disabled={pending}>
            {heightUrl ? "Replace height map" : "Upload height map"}
          </button>
          {heightUrl && (
            <button
              type="button"
              className={button}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await removeHeightMapAction(gameId);
                  if (r.ok) onHeight(null);
                  setMessage(r.ok ? { ok: true, text: "Height map removed: the map is flat." } : { ok: false, text: r.error });
                })
              }
            >
              Remove
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        {slider("relief", "How tall", 0, 0.3, 0.005, (v) => (v === 0 ? "flat" : `${Math.round(v * 100)}% of the width`))}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Sun</h3>
        {colour("sunColour", "Colour")}
        {slider("sunBearing", "Direction", 0, 360, 1, (v) => `${Math.round(v)}° ${compass(v)}`)}
        {slider("sunElevation", "Height in the sky", 5, 90, 1, (v) => `${Math.round(v)}°`)}
        {slider("sunIntensity", "Brightness", 0, 3, 0.05, (v) => v.toFixed(2))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={look.shadows} onChange={(e) => set("shadows", e.target.checked)} /> Hills cast shadows
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Sky and night</h3>
        {colour("ambientColour", "Sky light colour")}
        {slider("ambientIntensity", "Sky light", 0, 2, 0.05, (v) => v.toFixed(2))}
        {slider("darkness", "Darkness", 0, 1, 0.01, (v) => (v === 0 ? "day" : v >= 0.95 ? "deep night" : `${Math.round(v * 100)}%`))}
        <p className="text-xs text-muted">Darkness dims every light in 3D and darkens the 2D map too.</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () => {
              const r = await saveMapLookAction(gameId, look);
              if (r.ok) onSaved(look);
              setMessage(r.ok ? { ok: true, text: "Saved: everyone sees the map like this now." } : { ok: false, text: r.error });
            })
          }
        >
          Save look
        </button>
        <button type="button" className={button} disabled={!dirty} onClick={() => onChange(saved)}>
          Undo changes
        </button>
        <button type="button" className={button} onClick={() => onChange({ ...DEFAULT_MAP_LOOK, relief: look.relief })}>
          Default lighting
        </button>
      </div>
      {message && (
        <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

function compass(deg: number) {
  return ["top", "top right", "right", "bottom right", "bottom", "bottom left", "left", "top left"][Math.round(deg / 45) % 8];
}
