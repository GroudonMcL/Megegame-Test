"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import { useEscape } from "@/components/shell/useEscape";
import { dragUnits, isGreyed, radialSlots, selectedAmong, type StackEntry } from "./unitStack";

// The radial menu for the units at one spot: up to eight around the badge,
// more as a scrollable list beside it. Click a unit for its details; tick the
// ones a drag from the badge should move (only units the viewer can move have
// a tick box). It's ordinary page HTML laid over the map, so it works the same
// on the 2D map (SVG badges) and the 3D map (HTML badges): it finds the badge
// row by its data-spot attribute and follows it on screen while the map pans,
// zooms or turns.

const RING = 70;
const RING_WIDE = 84;

export function UnitRadial({
  spot,
  entries,
  selected,
  onToggle,
  onOpen,
  onClose,
}: {
  spot: string;
  entries: StackEntry[];
  selected: ReadonlySet<string>;
  onToggle: (entry: StackEntry) => void;
  onOpen: (entry: StackEntry) => void;
  onClose: () => void;
}) {
  const at = useAnchor(spot);
  useEscape(true, onClose);
  if (!at) return null;

  const here = selectedAmong(selected, entries.map((e) => e.id));
  const moving = dragUnits(entries, here).length;
  const anyMovable = entries.some((e) => e.movable);
  const radius = entries.length > 4 ? RING_WIDE : RING;
  const slots = radialSlots(entries.length, radius);
  const hint = anyMovable ? `Drag the badge to move ${here.size ? `the ${moving} ticked` : moving === 1 ? "the unit you can move" : `all ${moving} you can move`}` : "You can't move any of these";

  if (!slots) {
    // Too many for a ring: a list to the right of the badge (or the left, near the edge).
    const left = at.x + 200 + 24 > window.innerWidth;
    return createPortal(
      <div
        role="dialog"
        aria-label="Units here"
        className="fixed z-40 w-60 rounded-xl border border-border shadow-xl"
        style={{ left: left ? at.x - 24 - 240 : at.x + 24, top: Math.max(8, Math.min(at.y - 40, window.innerHeight - 360)) }}
      >
        <div className="glass-strong absolute inset-0 -z-10 rounded-xl" aria-hidden />
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs">
          <span className="font-medium">{entries.length} units here</span>
          <button type="button" className="ml-auto rounded px-1.5 text-muted hover:text-foreground" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="max-h-64 overflow-y-auto p-1">
          {entries.map((e) => (
            <li key={e.id} className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${isGreyed(e, here) ? "opacity-45" : ""}`}>
              {e.movable ? (
                <input type="checkbox" checked={here.has(e.id)} onChange={() => onToggle(e)} aria-label={`Move ${e.name}`} />
              ) : (
                <span className="inline-block w-[13px]" aria-hidden />
              )}
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-link" onClick={() => onOpen(e)}>
                <TeamEmblem team={e.owner} size={20} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm">
                    {e.name}
                    {e.dead ? " ✝" : ""}
                  </span>
                  <span className="block truncate text-[11px] text-muted">{e.note ?? e.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted">{hint}</p>
      </div>,
      document.body,
    );
  }

  // Keep the ring on screen.
  const margin = radius + 44;
  const cx = Math.min(Math.max(at.x, margin), window.innerWidth - margin);
  const cy = Math.min(Math.max(at.y, margin), window.innerHeight - margin);
  return createPortal(
    <div role="dialog" aria-label="Units here" className="pointer-events-none fixed z-40" style={{ left: cx, top: cy }}>
      {entries.map((e, i) => {
        const greyed = isGreyed(e, here);
        return (
          <div
            key={e.id}
            className={`pointer-events-auto absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center ${greyed ? "opacity-45" : ""}`}
            style={{ left: slots[i].x, top: slots[i].y }}
          >
            <span className="relative">
              <button
                type="button"
                className={`grid size-10 place-items-center rounded-full border-2 shadow-lg ${here.has(e.id) ? "border-accent" : "border-[var(--map-outline)]"} bg-raised hover:border-accent`}
                onClick={() => onOpen(e)}
                title={`${e.name} · ${e.note ?? e.detail}`}
              >
                <TeamEmblem team={e.owner} size={30} />
              </button>
              {e.movable && (
                <input
                  type="checkbox"
                  className="absolute -right-1 -bottom-1 size-4 cursor-pointer accent-[var(--accent)]"
                  checked={here.has(e.id)}
                  onChange={() => onToggle(e)}
                  aria-label={`Move ${e.name}`}
                  title="Tick to move with the badge"
                />
              )}
            </span>
            <span className="mt-0.5 max-w-20 truncate rounded px-1 text-[11px] leading-tight font-medium text-white" style={{ background: "var(--map-outline)" }}>
              {e.name}
              {e.dead ? " ✝" : ""}
            </span>
          </div>
        );
      })}
      <p
        className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white shadow"
        style={{ top: radius + 34, background: "var(--map-outline)" }}
      >
        {hint}
        <button type="button" className="ml-1 rounded px-1 hover:bg-white/20" onClick={onClose} aria-label="Close">
          ×
        </button>
      </p>
    </div>,
    document.body,
  );
}

/** Where the badge row for this spot is on screen (its centre), followed every frame; null while it isn't shown. */
function useAnchor(spot: string): { x: number; y: number } | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = document.querySelector(`[data-spot="${CSS.escape(spot)}"]`);
      const box = el?.getBoundingClientRect();
      // A 3D badge behind the camera is hidden.
      const next = el && box && box.width > 0 && getComputedStyle(el).visibility !== "hidden" ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } : null;
      setAt((p) => (p?.x === next?.x && p?.y === next?.y ? p : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [spot]);
  return at;
}
