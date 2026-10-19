"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { IconButton } from "@/components/ui";
import { useEscape } from "./useEscape";

// A window floating over the map: drag it by its title bar, resize it from its
// edges or corner, maximise it, close it with × or Escape. Position and size are
// remembered per tool in this browser. On narrow screens it fills the space
// under the toolbar instead.
//
// The frosted background is a separate layer, not a filter on the window
// itself, so fixed-position popups inside the content still cover the screen.

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  max: boolean;
}

const MARGIN = 12;
const MIN_W = 320;
const MIN_H = 220;
/** Below this desk width the window always fills the desk. */
const NARROW = 640;

function load(id: string): Box | null {
  try {
    const raw = localStorage.getItem(`window:${id}`);
    return raw ? (JSON.parse(raw) as Box) : null;
  } catch {
    return null;
  }
}
function save(id: string, box: Box) {
  try {
    localStorage.setItem(`window:${id}`, JSON.stringify(box));
  } catch {
    // Not remembered (private browsing).
  }
}

/** Keeps a box inside the desk, and at least its title bar reachable. */
function clamp(b: Box, desk: { w: number; h: number }): Box {
  const w = Math.min(Math.max(b.w, MIN_W), desk.w - MARGIN * 2);
  const h = Math.min(Math.max(b.h, MIN_H), desk.h - MARGIN * 2);
  const x = Math.min(Math.max(b.x, MARGIN), desk.w - w - MARGIN);
  const y = Math.min(Math.max(b.y, MARGIN), desk.h - h - MARGIN);
  return { ...b, x, y, w, h };
}

export function ToolWindow({
  id,
  title,
  icon,
  defaultWidth = 640,
  onClose,
  children,
}: {
  id: string;
  title: string;
  icon?: IconName;
  defaultWidth?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [desk, setDesk] = useState<{ w: number; h: number } | null>(null);
  // Where the player last put this window (null = docked on the left).
  const [placed, setPlaced] = useState<Box | null>(() => (typeof window === "undefined" ? null : load(id)));
  const gesture = useRef<{ kind: "move" | "e" | "s" | "se"; startX: number; startY: number; start: Box } | null>(null);

  useEscape(true, onClose);

  // Measure the desk (the window's parent) and keep the window inside it.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setDesk({ w: parent.clientWidth, h: parent.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // Kept inside the desk as the browser window changes size.
  const box = desk ? clamp(placed ?? { x: MARGIN, y: MARGIN, w: defaultWidth, h: desk.h - MARGIN * 2, max: false }, desk) : null;
  const narrow = desk ? desk.w < NARROW : false;
  const full = narrow || box?.max;

  const update = (b: Box, persist = false) => {
    if (!desk) return;
    const c = clamp(b, desk);
    setPlaced(c);
    if (persist) save(id, c);
  };

  const begin = (kind: "move" | "e" | "s" | "se", e: React.PointerEvent) => {
    if (!box || full || e.button !== 0) return;
    if (kind === "move" && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, start: box };
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const s = g.start;
    if (g.kind === "move") update({ ...s, x: s.x + dx, y: s.y + dy });
    else update({ ...s, w: g.kind === "s" ? s.w : s.w + dx, h: g.kind === "e" ? s.h : s.h + dy });
  };
  const end = () => {
    if (gesture.current && box) save(id, box);
    gesture.current = null;
  };
  const toggleMax = () => box && update({ ...box, max: !box.max }, true);

  const style = full || !box ? { left: narrow ? 0 : 8, top: narrow ? 0 : 8, right: narrow ? 0 : 8, bottom: narrow ? 0 : 8 } : { left: box.x, top: box.y, width: box.w, height: box.h };

  return (
    <section
      ref={ref}
      role="dialog"
      aria-label={title}
      className={`pointer-events-auto absolute z-20 flex flex-col overflow-hidden border border-border shadow-xl ${narrow ? "rounded-none" : "rounded-xl"} ${box ? "" : "invisible"}`}
      style={style}
    >
      <div className="glass-strong absolute inset-0 -z-10" aria-hidden />
      <header
        className={`flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 select-none ${full ? "" : "cursor-grab active:cursor-grabbing"}`}
        onPointerDown={(e) => begin("move", e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => !narrow && !(e.target as HTMLElement).closest("button") && toggleMax()}
      >
        {icon && <Icon name={icon} className="text-link" />}
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {!narrow && (
          <IconButton label={box?.max ? "Restore size" : "Maximise"} onClick={toggleMax} className="h-8 w-8">
            <Icon name={box?.max ? "restore" : "maximize"} size={16} />
          </IconButton>
        )}
        <IconButton label={`Close ${title}`} onClick={onClose} className="h-8 w-8">
          <Icon name="close" size={18} />
        </IconButton>
      </header>
      <div className="@container min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-4">{children}</div>
      {!full && (
        <>
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => begin("e", e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => begin("s", e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />
          <div
            className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize"
            onPointerDown={(e) => begin("se", e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            title="Drag to resize"
            aria-hidden
          />
        </>
      )}
    </section>
  );
}
