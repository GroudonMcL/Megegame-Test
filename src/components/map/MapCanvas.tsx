"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// An SVG map: an optional background image with region nodes and connections
// drawn on top. Pan by dragging the background, zoom with the wheel or a pinch.
// Node positions are fractions (0–1) of the map's width and height.

export interface MapNode {
  id: string;
  x: number;
  y: number;
  label: string;
  fill?: string;
  stroke?: string;
  /** Draw a larger ring, e.g. for a settlement. */
  ring?: boolean;
  dashed?: boolean;
  dim?: boolean;
}

export interface MapEdge {
  id: string;
  a: string;
  b: string;
  dashed?: boolean;
  colour?: string;
  /** Drawn thicker, e.g. difficult terrain. */
  heavy?: boolean;
  dim?: boolean;
}

export interface MapCanvasProps {
  width: number;
  height: number;
  imageUrl?: string | null;
  nodes: MapNode[];
  edges: MapEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  /** Nodes can be dragged; onNodeMove fires when a drag ends. */
  draggable?: boolean;
  snap?: number | null;
  onNodeMove?: (id: string, x: number, y: number) => void;
  /** badge = the data-badge value of the extra (from renderNodeExtras) that was clicked, if any. */
  onNodeClick?: (id: string, e: { shiftKey: boolean; badge?: string }) => void;
  onEdgeClick?: (id: string) => void;
  onBackgroundClick?: (x: number, y: number) => void;
  /** Draw a rubber-band line from this node to the pointer (connect mode). */
  linkFrom?: string | null;
  /** Extra SVG per node (unit badges…), given the node's pixel position and the screen scale. */
  renderNodeExtras?: (node: MapNode, px: { x: number; y: number }, scale: number) => ReactNode;
  className?: string;
  /** Changes when the parent asks to reset the view to fit the map. */
  fitKey?: number;
  /** Start zoomed to the nodes (e.g. the regions a team knows) rather than the whole map. */
  fitToNodes?: boolean;
  /** No frame (border and rounded corners), for a map that fills the screen. */
  bare?: boolean;
  /** Centre the view on this node whenever key changes. */
  focus?: { nodeId: string; key: number } | null;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CLICK_SLOP = 5;

export function MapCanvas(props: MapCanvasProps) {
  const { width, height } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, w: width, h: height });
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const gesture = useRef<
    | { kind: "pan"; startClient: { x: number; y: number }; startView: View; moved: boolean; edgeId?: string }
    | { kind: "node"; id: string; startClient: { x: number; y: number }; moved: boolean; shift: boolean; badge?: string }
    | { kind: "pinch"; startDist: number; startView: View; mid: { x: number; y: number } }
    | null
  >(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // Track the container size so nodes keep a constant on-screen size.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 });
    return () => ro.disconnect();
  }, []);

  const fitToNodes = props.fitToNodes && props.nodes.length > 0;
  const nodes = props.nodes;
  const fitView = useCallback(
    (whole = false): View => {
      const aspect = size.w / size.h;
      // The box to show: the whole map, or the nodes with a margin (never closer than a fifth of the map).
      let box = { x: 0, y: 0, w: width, h: height };
      if (fitToNodes && !whole) {
        const xs = nodes.map((n) => n.x * width);
        const ys = nodes.map((n) => n.y * height);
        const min = Math.max(width, height) / 5;
        const bw = Math.max(Math.max(...xs) - Math.min(...xs), min) * 1.3;
        const bh = Math.max(Math.max(...ys) - Math.min(...ys), min) * 1.3;
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
        const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        box = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
      }
      const w = Math.max(box.w, box.h * aspect);
      const h = w / aspect;
      return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
    },
    [width, height, size.w, size.h, fitToNodes, nodes],
  );
  const fit = (whole = false) => setView(fitView(whole));

  // Re-fit whenever the map or the container changes size (or the parent asks).
  const fitFor = `${width}:${height}:${size.w}:${size.h}:${props.fitKey ?? 0}`;
  const [fittedFor, setFittedFor] = useState("");
  if (fittedFor !== fitFor) {
    setFittedFor(fitFor);
    setView(fitView());
  }

  // Centre on a node when asked (keeping the zoom).
  const [focusedKey, setFocusedKey] = useState<number | null>(null);
  if (props.focus && props.focus.key !== focusedKey) {
    setFocusedKey(props.focus.key);
    const n = nodes.find((x) => x.id === props.focus!.nodeId);
    if (n) setView((v) => ({ ...v, x: n.x * width - v.w / 2, y: n.y * height - v.h / 2 }));
  }

  /** Screen pixels → map pixels. */
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: view.x + ((clientX - rect.left) / rect.width) * view.w, y: view.y + ((clientY - rect.top) / rect.height) * view.h };
    },
    [view],
  );

  const scale = view.w / size.w; // map pixels per screen pixel

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number, from: View = view) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      const w = Math.min(Math.max(from.w * factor, width / 40), width * 3);
      const h = w * (from.h / from.w);
      const px = from.x + fx * from.w;
      const py = from.y + fy * from.h;
      setView({ x: px - fx * w, y: py - fy * h, w, h });
    },
    [view, width],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const snapValue = (v: number) => (props.snap ? Math.round(v / props.snap) * props.snap : v);
  const clampFraction = (px: number, max: number) => Math.min(1, Math.max(0, snapValue(px) / max));

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      gesture.current = {
        kind: "pinch",
        startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        startView: view,
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      };
      return;
    }
    const nodeId = (e.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id");
    if (nodeId) {
      const badge = (e.target as Element).closest("[data-badge]")?.getAttribute("data-badge") ?? undefined;
      gesture.current = { kind: "node", id: nodeId, startClient: { x: e.clientX, y: e.clientY }, moved: false, shift: e.shiftKey, badge };
      return;
    }
    const edgeId = (e.target as Element).closest("[data-edge-id]")?.getAttribute("data-edge-id") ?? undefined;
    gesture.current = { kind: "pan", startClient: { x: e.clientX, y: e.clientY }, startView: view, moved: false, edgeId };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (props.linkFrom) setPointer(toMap(e.clientX, e.clientY));
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [p1, p2] = [...pointers.current.values()];
      if (!p2) return;
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      zoomAt(g.mid.x, g.mid.y, g.startDist / Math.max(dist, 1), g.startView);
      return;
    }
    const dx = e.clientX - g.startClient.x;
    const dy = e.clientY - g.startClient.y;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    g.moved = true;
    if (g.kind === "pan") {
      const k = g.startView.w / size.w;
      setView({ ...g.startView, x: g.startView.x - dx * k, y: g.startView.y - dy * k });
    } else if (g.kind === "node" && props.draggable) {
      const p = toMap(e.clientX, e.clientY);
      setDragPos({ id: g.id, x: clampFraction(p.x, width), y: clampFraction(p.y, height) });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "node") {
      if (g.moved && props.draggable && dragPos) {
        props.onNodeMove?.(g.id, dragPos.x, dragPos.y);
      } else if (!g.moved) {
        props.onNodeClick?.(g.id, { shiftKey: g.shift || e.shiftKey, badge: g.badge });
      }
      setDragPos(null);
    } else if (g.kind === "pan" && !g.moved && g.edgeId) {
      props.onEdgeClick?.(g.edgeId);
    } else if (g.kind === "pan" && !g.moved) {
      const p = toMap(e.clientX, e.clientY);
      if (p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height) props.onBackgroundClick?.(clampFraction(p.x, width), clampFraction(p.y, height));
    }
  };

  const pos = (n: MapNode) => (dragPos?.id === n.id ? { x: dragPos.x * width, y: dragPos.y * height } : { x: n.x * width, y: n.y * height });
  const byId = new Map(props.nodes.map((n) => [n.id, n]));
  const r = 9 * scale;
  const linkFrom = props.linkFrom ? byId.get(props.linkFrom) : undefined;

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${props.bare ? "" : "rounded-xl border border-border bg-background"} ${props.className ?? "h-[70vh]"}`}>
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid slice"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="Map"
      >
        <defs>
          <pattern id="map-grid" width={100} height={100} patternUnits="userSpaceOnUse">
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={2} />
          </pattern>
        </defs>
        {props.imageUrl ? (
          <image href={props.imageUrl} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />
        ) : (
          <rect x={0} y={0} width={width} height={height} fill="url(#map-grid)" className="text-foreground" />
        )}
        <rect x={0} y={0} width={width} height={height} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2 * scale} className="text-foreground" />

        {props.edges.map((e) => {
          const a = byId.get(e.a);
          const b = byId.get(e.b);
          if (!a || !b) return null;
          const pa = pos(a);
          const pb = pos(b);
          const selected = props.selectedEdgeId === e.id;
          return (
            <g key={e.id} data-edge-id={e.id} className="cursor-pointer">
              <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="transparent" strokeWidth={14 * scale} />
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={selected ? "var(--accent)" : (e.colour ?? "var(--map-route)")}
                strokeOpacity={e.dim ? 0.35 : 0.9}
                strokeWidth={(selected ? 5 : e.heavy ? 4 : 2.5) * scale}
                strokeDasharray={e.dashed ? `${8 * scale} ${6 * scale}` : undefined}
                style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,.9))" }}
              />
            </g>
          );
        })}

        {linkFrom && pointer && <line x1={pos(linkFrom).x} y1={pos(linkFrom).y} x2={pointer.x} y2={pointer.y} stroke="var(--accent)" strokeWidth={2.5 * scale} strokeDasharray={`${6 * scale} ${4 * scale}`} pointerEvents="none" />}

        {props.nodes.map((n) => {
          const p = pos(n);
          const selected = props.selectedNodeId === n.id;
          return (
            <g key={n.id} data-node-id={n.id} className={props.draggable ? "cursor-move" : "cursor-pointer"} opacity={n.dim ? 0.5 : 1}>
              {n.ring && <circle cx={p.x} cy={p.y} r={r * 1.6} fill="none" stroke={n.stroke ?? "var(--map-label)"} strokeWidth={2.5 * scale} />}
              <circle
                cx={p.x}
                cy={p.y}
                r={selected ? r * 1.3 : r}
                fill={n.fill ?? "var(--map-region)"}
                stroke={selected ? "var(--accent)" : (n.stroke ?? "var(--map-outline)")}
                strokeWidth={(selected ? 4 : 2) * scale}
                strokeDasharray={n.dashed ? `${4 * scale} ${3 * scale}` : undefined}
              />
              <text
                x={p.x}
                y={p.y - r * 1.9}
                textAnchor="middle"
                fontSize={12 * scale}
                fontWeight={600}
                fill="var(--map-label)"
                stroke="var(--map-label-outline)"
                strokeWidth={3 * scale}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {n.label}
              </text>
              {props.renderNodeExtras?.(n, p, scale)}
            </g>
          );
        })}
      </svg>
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-sm shadow hover:border-border-strong" onClick={() => zoomAt(size.w / 2 + svgRef.current!.getBoundingClientRect().left, size.h / 2 + svgRef.current!.getBoundingClientRect().top, 0.7)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-sm shadow hover:border-border-strong" onClick={() => zoomAt(size.w / 2 + svgRef.current!.getBoundingClientRect().left, size.h / 2 + svgRef.current!.getBoundingClientRect().top, 1.4)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-xs shadow hover:border-border-strong" onClick={() => fit()}>
          Fit
        </button>
        {fitToNodes && (
          <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-xs shadow hover:border-border-strong" onClick={() => fit(true)}>
            Whole map
          </button>
        )}
      </div>
    </div>
  );
}
