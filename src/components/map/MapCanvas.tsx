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
  onNodeClick?: (id: string, e: { shiftKey: boolean }) => void;
  onEdgeClick?: (id: string) => void;
  onBackgroundClick?: (x: number, y: number) => void;
  /** Draw a rubber-band line from this node to the pointer (connect mode). */
  linkFrom?: string | null;
  /** Extra SVG per node (unit badges…), given the node's pixel position and the screen scale. */
  renderNodeExtras?: (node: MapNode, px: { x: number; y: number }, scale: number) => ReactNode;
  className?: string;
  /** Changes when the parent asks to reset the view to fit the map. */
  fitKey?: number;
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
    | { kind: "node"; id: string; startClient: { x: number; y: number }; moved: boolean; shift: boolean }
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

  const fitView = useCallback((): View => {
    const aspect = size.w / size.h;
    const w = Math.max(width, height * aspect);
    const h = w / aspect;
    return { x: (width - w) / 2, y: (height - h) / 2, w, h };
  }, [width, height, size.w, size.h]);
  const fit = () => setView(fitView());

  // Re-fit whenever the map or the container changes size (or the parent asks).
  const fitFor = `${width}:${height}:${size.w}:${size.h}:${props.fitKey ?? 0}`;
  const [fittedFor, setFittedFor] = useState("");
  if (fittedFor !== fitFor) {
    setFittedFor(fitFor);
    setView(fitView());
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
      gesture.current = { kind: "node", id: nodeId, startClient: { x: e.clientX, y: e.clientY }, moved: false, shift: e.shiftKey };
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
        props.onNodeClick?.(g.id, { shiftKey: g.shift || e.shiftKey });
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
    <div ref={wrapRef} className={`relative overflow-hidden rounded-xl border border-border bg-background ${props.className ?? "h-[70vh]"}`}>
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
                stroke={selected ? "var(--accent)" : (e.colour ?? "#f8fafc")}
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
              {n.ring && <circle cx={p.x} cy={p.y} r={r * 1.6} fill="none" stroke={n.stroke ?? "#fff"} strokeWidth={2.5 * scale} />}
              <circle
                cx={p.x}
                cy={p.y}
                r={selected ? r * 1.3 : r}
                fill={n.fill ?? "#e2e8f0"}
                stroke={selected ? "var(--accent)" : (n.stroke ?? "#0f172a")}
                strokeWidth={(selected ? 4 : 2) * scale}
                strokeDasharray={n.dashed ? `${4 * scale} ${3 * scale}` : undefined}
              />
              <text
                x={p.x}
                y={p.y - r * 1.9}
                textAnchor="middle"
                fontSize={12 * scale}
                fontWeight={600}
                fill="#fff"
                stroke="#000"
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
        <button type="button" className="rounded-md border border-border bg-card px-2 py-1 text-sm shadow" onClick={() => zoomAt(size.w / 2 + svgRef.current!.getBoundingClientRect().left, size.h / 2 + svgRef.current!.getBoundingClientRect().top, 0.7)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="rounded-md border border-border bg-card px-2 py-1 text-sm shadow" onClick={() => zoomAt(size.w / 2 + svgRef.current!.getBoundingClientRect().left, size.h / 2 + svgRef.current!.getBoundingClientRect().top, 1.4)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="rounded-md border border-border bg-card px-2 py-1 text-xs shadow" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}
