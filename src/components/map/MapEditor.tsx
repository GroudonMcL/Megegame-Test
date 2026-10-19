"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  createLinkAction,
  createRegionAction,
  createTerrainAction,
  deleteConnectionAction,
  deleteRegionAction,
  deleteTerrainAction,
  fillShapesAction,
  importRegionsAction,
  moveRegionAction,
  saveShapesAction,
  setScaleAction,
  updateConnectionAction,
  updateRegionAction,
  updateTerrainAction,
  uploadMapImageAction,
} from "@/app/dm/games/[gameId]/map/actions";
import { addSnapCorner, insertCorner, moveCorner, removeCorner, snapPoint, traceBetween, type ShapeMap, type Snap } from "@/engine/geo/edit";
import { length, type Polygon, type Pt } from "@/engine/geo/polygon";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { compressImage } from "./compressImage";
import { MapCanvas, type MapNode } from "./MapCanvas";
import { DEFAULT_MAP_SIZE, type ConnectionData, type MapImageData, type RegionData, type TeamData, type TerrainAreaData } from "./mapData";
import { ConnectionPanel, CsvDialog, RegionPanel, regionFields, TerrainPanel } from "./mapEditorParts";
import { connectionEdges, terrainLayer } from "./mapLayers";
import { terrainColour } from "./terrainStyle";

// The GM's map editor: regions are shapes drawn over the map image, terrain
// areas are shapes drawn over the regions, and links join regions that don't
// touch. Regions that touch are neighbours; their borders are kept up to date
// on the server (syncBorders) and can be blocked or hidden here.
//
// Modes: Select (edit details), Shapes (drag corners; shared corners move in
// every shape), Draw region, Draw terrain, Link, and Scale. Corner and shape
// edits wait until "Save shapes"; everything else saves straight away.

type Mode = "select" | "shapes" | "draw" | "terrain" | "link" | "scale";
type Selection = { kind: "region"; id: string } | { kind: "connection"; id: string } | { kind: "terrain"; id: string } | null;

const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50";
/** How close (in screen pixels) the pointer must be to snap to a corner or edge. */
const SNAP_PX = 10;

const MODE_HELP: Record<Mode, string> = {
  select: "Click a region, a link or a blocked border to edit it. Drag the dot in the selected region to move its centre. Drag the map to pan; scroll or pinch to zoom.",
  shapes: "Drag a corner to move it (a corner shared by several shapes moves in all of them). Click a + to add a corner in the middle of an edge; right-click (or shift-click) a corner to remove it. Then Save shapes.",
  draw: "Click to place corners; they snap to nearby corners and edges, and follow a neighbour's border when two corners in a row land on it. Click the first corner (or press Enter) to finish, Backspace to undo a corner, Esc to stop.",
  terrain: "Draw a terrain area like a region: click corners, then click the first one (or press Enter). The part of a move inside it follows its terrain's rules.",
  link: "Click a region, then another region it doesn't touch, to join them with a link (a tunnel, a sea lane…). Esc to stop.",
  scale: "Click two points a known distance apart on the map image (a scale bar, or two towns), then say how many miles apart they are.",
};

export function MapEditor(props: {
  gameId: string;
  ruleset: Ruleset;
  regions: RegionData[];
  connections: ConnectionData[];
  terrainAreas: TerrainAreaData[];
  teams: TeamData[];
  mapImage: MapImageData | null;
  milesAcross: number;
  conversionReport: string | null;
}) {
  const { gameId, ruleset, teams } = props;
  const router = useRouter();
  const [regions, setRegions] = useState(props.regions);
  const [connections, setConnections] = useState(props.connections);
  const [terrain, setTerrain] = useState(props.terrainAreas);
  const [mapImage, setMapImage] = useState(props.mapImage);
  const [milesAcross, setMilesAcross] = useState(props.milesAcross);
  const [mode, setModeState] = useState<Mode>("select");
  const [layer, setLayer] = useState<"regions" | "terrain">("regions");
  const [selection, setSelection] = useState<Selection>(null);
  // Unsaved shape edits (Shapes mode), by region / terrain area ID.
  const [draftRegions, setDraftRegions] = useState<ShapeMap>({});
  const [draftTerrain, setDraftTerrain] = useState<ShapeMap>({});
  // A shape being drawn: its corners and what each snapped to.
  const [drawing, setDrawing] = useState<Snap[]>([]);
  const [drawFor, setDrawFor] = useState<string | null>(null);
  const [drawTerrainType, setDrawTerrainType] = useState(() => ruleset.terrainTypes.find((t) => t.id !== "normal")?.id ?? ruleset.terrainTypes[0]?.id ?? "");
  const [hover, setHover] = useState<Pt | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [scalePts, setScalePts] = useState<Pt[]>([]);
  const [scaleMiles, setScaleMiles] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  // Map pixels per screen pixel, as last drawn (for snapping distances).
  const scaleRef = useRef(1);
  // The corner being dragged: where it is now.
  const drag = useRef<{ id: string; from: Pt } | null>(null);
  // Handle positions as last drawn (corner handles, edge-midpoint handles).
  const handlesRef = useRef<{ corners: Pt[]; edges: [Pt, Pt][] }>({ corners: [], edges: [] });

  // Server data wins after a refresh (e.g. after a CSV import).
  const [serverData, setServerData] = useState(props);
  if (serverData !== props && (serverData.regions !== props.regions || serverData.connections !== props.connections || serverData.terrainAreas !== props.terrainAreas || serverData.mapImage !== props.mapImage)) {
    setServerData(props);
    setRegions(props.regions);
    setConnections(props.connections);
    setTerrain(props.terrainAreas);
    setMapImage(props.mapImage);
    setMilesAcross(props.milesAcross);
  }

  const size = mapImage ?? DEFAULT_MAP_SIZE;
  const aspect = size.height / size.width;
  const ctx = useMemo(() => ({ ruleset }), [ruleset]);
  const fields = useMemo(() => regionFields(teams), [teams]);
  const teamColour = useMemo(() => new Map(teams.map((t) => [t.id, t.colour])), [teams]);
  const report = (ok: boolean, text: string) => setMessage({ ok, text });
  const code = (id: string) => regions.find((r) => r.id === id)?.code ?? "?";

  const regionShapes: ShapeMap = useMemo(() => {
    const out: ShapeMap = {};
    for (const r of regions) {
      const p = draftRegions[r.id] ?? r.polygon;
      if (p.length >= 3) out[r.id] = p;
    }
    return out;
  }, [regions, draftRegions]);
  const terrainShapes: ShapeMap = useMemo(() => Object.fromEntries(terrain.map((t) => [t.id, draftTerrain[t.id] ?? t.polygon])), [terrain, draftTerrain]);
  const dirty = Object.keys(draftRegions).length + Object.keys(draftTerrain).length;

  const setMode = (m: Mode) => {
    setModeState(m);
    setDrawing([]);
    setLinkFrom(null);
    setScalePts([]);
    if (m !== "draw") setDrawFor(null);
  };

  // ——— Shapes ———

  /** The shapes the snapping and corner handles work on. */
  const activeShapes = mode === "shapes" && layer === "terrain" ? terrainShapes : regionShapes;
  const setActiveShapes = (next: ShapeMap) => {
    const isTerrain = mode === "shapes" && layer === "terrain";
    const saved = isTerrain ? Object.fromEntries(terrain.map((t) => [t.id, t.polygon])) : Object.fromEntries(regions.map((r) => [r.id, r.polygon]));
    const changed: ShapeMap = {};
    for (const [id, poly] of Object.entries(next)) if (JSON.stringify(poly) !== JSON.stringify(saved[id])) changed[id] = poly;
    if (isTerrain) setDraftTerrain(changed);
    else setDraftRegions(changed);
  };
  const snapTol = () => (SNAP_PX * scaleRef.current) / size.width;
  const snapAll = (p: Pt) => snapPoint(p, { ...regionShapes, ...Object.fromEntries(Object.entries(terrainShapes).map(([k, v]) => [`t:${k}`, v])) }, snapTol(), aspect);

  const saveShapes = () =>
    startTransition(async () => {
      const r = await saveShapesAction(gameId, {
        regions: Object.entries(draftRegions).map(([id, polygon]) => ({ id, polygon })),
        terrain: Object.entries(draftTerrain).map(([id, polygon]) => ({ id, polygon })),
      });
      if (!r.ok) return report(false, r.error);
      const byId = new Map(r.value.regions.map((x) => [x.id, x as RegionData]));
      setRegions((rs) => rs.map((x) => byId.get(x.id) ?? x));
      setTerrain((ts) => ts.map((t) => (draftTerrain[t.id] ? { ...t, polygon: draftTerrain[t.id] } : t)));
      setConnections(r.value.connections as ConnectionData[]);
      setDraftRegions({});
      setDraftTerrain({});
      report(true, `Shapes saved.${r.value.added || r.value.removed ? ` Borders: ${r.value.added} new, ${r.value.removed} gone.` : ""}`);
    });

  /** Finishes the shape being drawn: a new region, a region's new shape, or a terrain area. */
  const finishDrawing = () => {
    if (drawing.length < 3) return report(false, "A shape needs at least 3 corners.");
    const polygon: Polygon = drawing.map((s) => s.p);
    if (mode === "terrain") {
      startTransition(async () => {
        const r = await createTerrainAction(gameId, drawTerrainType, polygon);
        if (!r.ok) return report(false, r.error);
        setTerrain((ts) => [...ts, r.value as TerrainAreaData]);
        setDrawing([]);
        setSelection({ kind: "terrain", id: r.value.id });
        report(true, "Terrain area added.");
      });
      return;
    }
    // Neighbours get the corners the new shape snapped onto mid-edge, so they share them exactly.
    let neighbours = regionShapes;
    for (const s of drawing) if (s.kind === "edge" && !s.shape.startsWith("t:")) neighbours = addSnapCorner(neighbours, s);
    const touched = Object.entries(neighbours).filter(([id, p]) => p !== regionShapes[id]);
    const pendingRegions = { ...draftRegions, ...Object.fromEntries(touched) };
    startTransition(async () => {
      const target = drawFor;
      const edits = { regions: Object.entries(target ? { ...pendingRegions, [target]: polygon } : pendingRegions).map(([id, p]) => ({ id, polygon: p })), terrain: Object.entries(draftTerrain).map(([id, p]) => ({ id, polygon: p })) };
      if (edits.regions.length || edits.terrain.length) {
        const saved = await saveShapesAction(gameId, edits);
        if (!saved.ok) return report(false, saved.error);
        const byId = new Map(saved.value.regions.map((x) => [x.id, x as RegionData]));
        setRegions((rs) => rs.map((x) => byId.get(x.id) ?? x));
        setConnections(saved.value.connections as ConnectionData[]);
        setDraftRegions({});
        setDraftTerrain({});
      }
      if (!target) {
        const r = await createRegionAction(gameId, polygon);
        if (!r.ok) return report(false, r.error);
        setRegions((rs) => [...rs, r.value.region as RegionData]);
        setConnections(r.value.connections as ConnectionData[]);
        setSelection({ kind: "region", id: r.value.region.id });
        report(true, `Region ${r.value.region.code} added.`);
      } else {
        setSelection({ kind: "region", id: target });
        report(true, `New shape for ${code(target)} saved.`);
        setMode("select");
      }
      setDrawing([]);
    });
  };

  const addDrawPoint = (p: Pt) => {
    const s = snapAll(p);
    const first = drawing[0];
    if (first && drawing.length >= 3 && length(first.p, s.p, aspect) <= snapTol()) return finishDrawing();
    // Two corners in a row on the same neighbour: follow its border between them.
    const prev = drawing[drawing.length - 1];
    const extra: Snap[] = [];
    if (prev && prev.kind !== "free" && s.kind !== "free" && prev.shape === s.shape) {
      const shape = s.shape.startsWith("t:") ? terrainShapes[s.shape.slice(2)] : regionShapes[s.shape];
      if (shape) for (const q of traceBetween(shape, prev.p, s.p)) extra.push({ p: q, kind: "free" });
    }
    setDrawing([...drawing, ...extra, s]);
  };

  // ——— Handles: corners, edge midpoints, the selected region's centre ———

  const onHandleMove = (id: string, p: Pt, done: boolean) => {
    if (id === "centre" && selection?.kind === "region") {
      const rid = selection.id;
      setRegions((rs) => rs.map((r) => (r.id === rid ? { ...r, x: p[0], y: p[1] } : r)));
      if (done) startTransition(() => moveRegionAction(gameId, rid, Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))));
      return;
    }
    if (!id.startsWith("v:")) return;
    if (!drag.current || drag.current.id !== id) drag.current = { id, from: handlesRef.current.corners[Number(id.slice(2))] };
    const from = drag.current.from;
    if (!from) return;
    // Snap to other corners and edges, but not to the corner being dragged.
    const others: ShapeMap = {};
    for (const [k, poly] of Object.entries(activeShapes)) others[k] = poly.filter((v) => length(v, from, aspect) > 1e-9);
    const to = snapPoint(p, others, snapTol(), aspect).p;
    setActiveShapes(moveCorner(activeShapes, from, to));
    drag.current = done ? null : { id, from: to };
  };

  const onHandleClick = (id: string, e: { button: number; shiftKey: boolean }) => {
    if (id.startsWith("v:") && (e.button === 2 || e.shiftKey)) {
      const at = handlesRef.current.corners[Number(id.slice(2))];
      const next = at && removeCorner(activeShapes, at);
      if (next) setActiveShapes(next);
      else report(false, "A shape needs at least 3 corners.");
    } else if (id.startsWith("m:")) {
      const [a, b] = handlesRef.current.edges[Number(id.slice(2))] ?? [];
      if (a && b) setActiveShapes(insertCorner(activeShapes, a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
    }
  };

  // ——— Clicks ———

  const onNodeClick = (id: string) => {
    if (mode === "link") {
      if (!linkFrom) return setLinkFrom(id);
      if (linkFrom === id) return setLinkFrom(null);
      startTransition(async () => {
        const r = await createLinkAction(gameId, linkFrom, id);
        if (r.ok) {
          setConnections((cs) => [...cs, r.value as ConnectionData]);
          setSelection({ kind: "connection", id: r.value.id });
          report(true, `Linked ${code(linkFrom)} and ${code(id)}.`);
        } else report(false, r.error);
        setLinkFrom(null);
      });
      return;
    }
    if (mode === "select" || mode === "shapes") setSelection({ kind: "region", id });
  };

  const onPointClick = (p: Pt) => {
    if (mode === "draw" || mode === "terrain") addDrawPoint(p);
    else if (mode === "scale") setScalePts((pts) => (pts.length >= 2 ? [p] : [...pts, p]));
  };

  const setScaleFromLine = () => {
    const miles = Number(scaleMiles);
    if (scalePts.length !== 2 || !(miles > 0)) return report(false, "Click two points, then give the miles between them.");
    const across = miles / length(scalePts[0], scalePts[1], aspect);
    saveScale(across);
    setScalePts([]);
    setScaleMiles("");
  };
  const saveScale = (value: number) =>
    startTransition(async () => {
      const r = await setScaleAction(gameId, value);
      if (r.ok) {
        setMilesAcross(r.value);
        report(true, `Scale set: ${r.value} miles across the map.`);
      } else report(false, r.error);
    });

  const deleteSelected = () => {
    if (!selection) return;
    if (selection.kind === "region") {
      const r = regions.find((x) => x.id === selection.id);
      if (!r || !confirm(`Delete region ${r.code}? Its borders and links go too, and any units in it are left without a location.`)) return;
      setRegions((rs) => rs.filter((x) => x.id !== r.id));
      setConnections((cs) => cs.filter((c) => c.regionA !== r.id && c.regionB !== r.id));
      startTransition(() => deleteRegionAction(gameId, r.id));
    } else if (selection.kind === "terrain") {
      setTerrain((ts) => ts.filter((t) => t.id !== selection.id));
      startTransition(() => deleteTerrainAction(gameId, selection.id));
    } else {
      startTransition(async () => {
        const r = await deleteConnectionAction(gameId, selection.id);
        if (r.ok) setConnections((cs) => cs.filter((c) => c.id !== selection.id));
        else report(false, r.error);
      });
    }
    setSelection(null);
  };

  const saveConnection = (c: ConnectionData, patch: Partial<{ miles: number | null; terrainId: string; hidden: boolean; blocked: boolean }>) =>
    startTransition(async () => {
      const r = await updateConnectionAction(gameId, c.id, { miles: c.miles, terrainId: c.terrainId, hidden: c.hidden, blocked: c.blocked, ...patch });
      if (r.ok) setConnections((cs) => cs.map((x) => (x.id === c.id ? (r.value as ConnectionData) : x)));
      else report(false, r.error);
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") {
        if (drawing.length) setDrawing([]);
        else if (linkFrom) setLinkFrom(null);
        else if (mode !== "select") setMode("select");
        else setSelection(null);
      } else if (e.key === "Enter" && drawing.length >= 3) finishDrawing();
      else if (e.key === "Backspace" && drawing.length) setDrawing(drawing.slice(0, -1));
      else if (e.key === "v") setMode("select");
      else if (e.key === "e") setMode("shapes");
      else if (e.key === "d") setMode("draw");
      else if (e.key === "t") setMode("terrain");
      else if (e.key === "l") setMode("link");
      else if (e.key === "Delete" && mode === "select") deleteSelected();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onUpload = async (file: File) => {
    try {
      report(true, "Shrinking and uploading the image…");
      const { blob, width, height } = await compressImage(file);
      const form = new FormData();
      form.set("image", blob, "map");
      form.set("width", String(width));
      form.set("height", String(height));
      const r = await uploadMapImageAction(gameId, form);
      if (r.ok) {
        setMapImage(r.value);
        report(true, `Map image uploaded (${width} × ${height}). Shapes stay where they are on the map, as fractions of its size.`);
      } else report(false, r.error);
    } catch (err) {
      report(false, err instanceof Error ? err.message : "Upload failed.");
    }
  };

  // ——— What the map draws ———

  const selectedRegion = selection?.kind === "region" ? regions.find((r) => r.id === selection.id) : undefined;
  const selectedConnection = selection?.kind === "connection" ? connections.find((c) => c.id === selection.id) : undefined;
  const selectedTerrain = selection?.kind === "terrain" ? terrain.find((t) => t.id === selection.id) : undefined;
  const shapeless = regions.filter((r) => !regionShapes[r.id]);

  const nodes: MapNode[] = regions.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    polygon: regionShapes[r.id],
    label: r.name ? `${r.code} ${r.name}` : r.code,
    fill: r.ownerTeamId ? teamColour.get(r.ownerTeamId) : r.settleable ? undefined : "var(--map-region-unsettleable)",
    ring: Boolean(r.settlementTierId),
    dashed: r.hidden,
    dim: r.hidden,
  }));
  const edges = connectionEdges(connections, (id) => regionShapes[id], ruleset);
  const terrainView = terrainLayer(
    terrain.map((t) => ({ id: t.id, terrainId: t.terrainId, pieces: [[terrainShapes[t.id]]] })),
    ruleset,
  );

  const overlay = (scale: number): ReactNode => {
    scaleRef.current = scale;
    const W = size.width;
    const H = size.height;
    const px = ([x, y]: Pt) => ({ cx: x * W, cy: y * H });
    const out: ReactNode[] = [];

    if (selectedTerrain) {
      const d = `M${(terrainShapes[selectedTerrain.id] ?? []).map(([x, y]) => `${x * W} ${y * H}`).join("L")}Z`;
      out.push(<path key="sel-terrain" d={d} fill="none" stroke="var(--accent)" strokeWidth={3 * scale} pointerEvents="none" />);
    }

    if (mode === "shapes") {
      // One handle per spot (shared corners are one handle), and a + in the middle of each edge.
      const seen = new Map<string, Pt>();
      const edgeSeen = new Map<string, [Pt, Pt]>();
      for (const poly of Object.values(activeShapes)) {
        poly.forEach((v, i) => {
          seen.set(`${v[0].toFixed(6)},${v[1].toFixed(6)}`, v);
          const w = poly[(i + 1) % poly.length];
          const k = [v, w].map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).sort().join("|");
          if (!edgeSeen.has(k)) edgeSeen.set(k, [v, w]);
        });
      }
      const corners = [...seen.values()];
      const edgeList = [...edgeSeen.values()];
      handlesRef.current = { corners, edges: edgeList };
      edgeList.forEach(([a, b], i) => {
        const m = px([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        out.push(
          <g key={`m${i}`} data-handle={`m:${i}`} className="cursor-copy">
            <circle cx={m.cx} cy={m.cy} r={5 * scale} fill="var(--card-solid)" stroke="var(--accent)" strokeWidth={1.5 * scale} />
            <path d={`M${m.cx - 3 * scale} ${m.cy}H${m.cx + 3 * scale}M${m.cx} ${m.cy - 3 * scale}V${m.cy + 3 * scale}`} stroke="var(--accent)" strokeWidth={1.5 * scale} />
          </g>,
        );
      });
      corners.forEach((v, i) => {
        const c = px(v);
        out.push(<circle key={`v${i}`} data-handle={`v:${i}`} cx={c.cx} cy={c.cy} r={6 * scale} fill="var(--accent)" stroke="var(--map-outline)" strokeWidth={1.5 * scale} className="cursor-grab" />);
      });
    }

    if (mode === "select" && selectedRegion) {
      const c = px([selectedRegion.x, selectedRegion.y]);
      out.push(<circle key="centre" data-handle="centre" cx={c.cx} cy={c.cy} r={7 * scale} fill="var(--accent)" stroke="var(--map-outline)" strokeWidth={2 * scale} className="cursor-move" />);
    }

    if ((mode === "draw" || mode === "terrain") && (drawing.length || hover)) {
      const snapped = hover ? snapAll(hover) : null;
      const pts = [...drawing.map((s) => s.p), ...(snapped ? [snapped.p] : [])];
      const colour = mode === "terrain" ? terrainColour(ruleset.terrainTypes.find((t) => t.id === drawTerrainType)) : "var(--accent)";
      out.push(
        <g key="drawing" pointerEvents="none">
          {pts.length > 1 && <polyline points={pts.map(([x, y]) => `${x * W},${y * H}`).join(" ")} fill="none" stroke={colour} strokeWidth={2.5 * scale} strokeDasharray={`${6 * scale} ${4 * scale}`} />}
          {drawing.map((s, i) => (
            <circle key={i} {...px(s.p)} r={(i === 0 ? 7 : 4) * scale} fill={i === 0 ? "var(--card-solid)" : colour} stroke={colour} strokeWidth={2 * scale} />
          ))}
          {snapped && snapped.kind !== "free" && <circle {...px(snapped.p)} r={8 * scale} fill="none" stroke="var(--ok)" strokeWidth={2 * scale} />}
        </g>,
      );
    }

    if (mode === "scale" && scalePts.length) {
      const pts = [...scalePts, ...(scalePts.length === 1 && hover ? [hover] : [])];
      out.push(
        <g key="scale" pointerEvents="none">
          <polyline points={pts.map(([x, y]) => `${x * W},${y * H}`).join(" ")} fill="none" stroke="var(--warn)" strokeWidth={3 * scale} />
          {scalePts.map((p, i) => (
            <circle key={i} {...px(p)} r={5 * scale} fill="var(--warn)" />
          ))}
        </g>,
      );
    }
    return out;
  };

  const modeButton = (m: Mode, label: string, key: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-accent text-accent-foreground" : "border border-border hover:bg-background"}`}
      aria-pressed={mode === m}
      title={`Shortcut: ${key}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      {props.conversionReport && <ConversionReport text={props.conversionReport} gameId={gameId} />}
      <div className="flex flex-wrap items-center gap-2">
        {modeButton("select", "Select", "V")}
        {modeButton("shapes", "Edit shapes", "E")}
        {modeButton("draw", "Draw region", "D")}
        {modeButton("terrain", "Draw terrain", "T")}
        {modeButton("link", "Link", "L")}
        {modeButton("scale", "Measure scale", "")}
        {dirty > 0 && (
          <>
            <span className="mx-1 h-6 w-px bg-border" />
            <button type="button" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50" onClick={saveShapes} disabled={pending}>
              Save shapes ({dirty})
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setDraftRegions({});
                setDraftTerrain({});
              }}
            >
              Discard
            </button>
          </>
        )}
        <span className="mx-1 h-6 w-px bg-border" />
        <button type="button" className={button} onClick={() => fileRef.current?.click()} disabled={pending}>
          {mapImage ? "Replace map image" : "Upload map image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        <button type="button" className={button} onClick={() => setCsvOpen(true)}>
          Import regions (CSV)
        </button>
        <ScaleInput value={milesAcross} onSave={saveScale} pending={pending} />
      </div>

      {mode === "shapes" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Editing:</span>
          {(["regions", "terrain"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLayer(l)} className={`rounded-md px-2.5 py-1 ${layer === l ? "bg-raised font-medium" : "text-muted hover:text-foreground"}`} aria-pressed={layer === l}>
              {l === "regions" ? "Region shapes" : "Terrain areas"}
            </button>
          ))}
        </div>
      )}
      {mode === "draw" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Drawing:</span>
          <select className="rounded-md border border-border bg-background px-2 py-1" value={drawFor ?? ""} onChange={(e) => setDrawFor(e.target.value || null)} aria-label="Draw a shape for">
            <option value="">a new region</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                a new shape for {r.code}
                {regionShapes[r.id] ? "" : " (none yet)"}
              </option>
            ))}
          </select>
        </div>
      )}
      {mode === "terrain" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Terrain type:</span>
          <select className="rounded-md border border-border bg-background px-2 py-1" value={drawTerrainType} onChange={(e) => setDrawTerrainType(e.target.value)} aria-label="Terrain type">
            {ruleset.terrainTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {mode === "scale" && scalePts.length === 2 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Those two points are</span>
          <input type="number" min={0} className="w-24 rounded-md border border-border bg-background px-2 py-1" value={scaleMiles} onChange={(e) => setScaleMiles(e.target.value)} aria-label="Miles between the points" autoFocus />
          <span>miles apart.</span>
          <button type="button" className="rounded-md bg-accent px-3 py-1.5 text-accent-foreground" onClick={setScaleFromLine} disabled={pending}>
            Set scale
          </button>
        </div>
      )}

      <p className="text-sm text-muted">
        {mode === "link" && linkFrom ? `Click the region to link ${code(linkFrom)} to.` : MODE_HELP[mode]}
        {(mode === "draw" || mode === "terrain") && drawing.length > 0 && ` (${drawing.length} corner${drawing.length === 1 ? "" : "s"} so far)`}
      </p>
      {message && (
        <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem] [&>*]:min-w-0">
        <MapCanvas
          width={size.width}
          height={size.height}
          imageUrl={mapImage ? `/api/assets/${mapImage.id}` : null}
          nodes={nodes}
          edges={edges}
          terrain={terrainView}
          selectedNodeId={selectedRegion?.id ?? linkFrom}
          selectedEdgeId={selectedConnection?.id}
          onNodeClick={onNodeClick}
          onEdgeClick={(id) => mode === "select" && setSelection({ kind: "connection", id })}
          onBackgroundClick={() => mode === "select" && setSelection(null)}
          onPointClick={onPointClick}
          onHandleMove={onHandleMove}
          onHandleClick={onHandleClick}
          onHover={mode === "draw" || mode === "terrain" || mode === "scale" ? setHover : undefined}
          linkFrom={mode === "link" ? linkFrom : null}
          overlay={overlay}
          className="h-[72vh]"
        />

        <aside className="min-w-0 glass rounded-xl border border-border shadow-panel p-4 lg:max-h-[72vh] lg:overflow-y-auto">
          {selectedRegion && (
            <RegionPanel
              key={selectedRegion.id}
              region={{ ...selectedRegion, polygon: regionShapes[selectedRegion.id] ?? [] }}
              fields={fields}
              ctx={ctx}
              pending={pending}
              onSave={(patch) =>
                startTransition(async () => {
                  const r = await updateRegionAction(gameId, selectedRegion.id, patch);
                  if (r.ok) {
                    setRegions((rs) => rs.map((x) => (x.id === selectedRegion.id ? (r.value as RegionData) : x)));
                    report(true, `Saved ${r.value.code}.`);
                  } else report(false, r.error);
                })
              }
              onDelete={deleteSelected}
              onRedraw={() => {
                setMode("draw");
                setDrawFor(selectedRegion.id);
              }}
              borders={connections
                .filter((c) => c.kind === "border" && (c.regionA === selectedRegion.id || c.regionB === selectedRegion.id))
                .map((c) => ({ connection: c, to: code(c.regionA === selectedRegion.id ? c.regionB : c.regionA) }))
                .sort((a, b) => a.to.localeCompare(b.to, undefined, { numeric: true }))}
              links={connections
                .filter((c) => c.kind !== "border" && (c.regionA === selectedRegion.id || c.regionB === selectedRegion.id))
                .map((c) => ({ connection: c, to: code(c.regionA === selectedRegion.id ? c.regionB : c.regionA) }))}
              onBorder={(c, patch) => saveConnection(c, patch)}
              onSelectConnection={(id) => setSelection({ kind: "connection", id })}
            />
          )}
          {selectedConnection && (
            <ConnectionPanel
              key={selectedConnection.id}
              connection={selectedConnection}
              title={[code(selectedConnection.regionA), code(selectedConnection.regionB)].sort().join(" ↔ ")}
              ctx={ctx}
              pending={pending}
              onSave={(patch) => saveConnection(selectedConnection, patch)}
              onDelete={deleteSelected}
            />
          )}
          {selectedTerrain && (
            <TerrainPanel
              key={selectedTerrain.id}
              area={selectedTerrain}
              ctx={ctx}
              pending={pending}
              onSave={(patch) =>
                startTransition(async () => {
                  const r = await updateTerrainAction(gameId, selectedTerrain.id, patch);
                  if (r.ok) setTerrain((ts) => ts.map((t) => (t.id === selectedTerrain.id ? { ...t, ...patch } : t)));
                  else report(false, r.error);
                })
              }
              onDelete={deleteSelected}
              onEditShape={() => {
                setMode("shapes");
                setLayer("terrain");
              }}
            />
          )}
          {!selection && (
            <div className="space-y-3 text-sm">
              <p className="text-muted">
                {regions.length} regions · {terrain.length} terrain areas · {connections.filter((c) => c.kind === "link").length} links ·{" "}
                {connections.filter((c) => c.kind === "border" && c.blocked).length} blocked borders
              </p>
              {shapeless.length > 0 && (
                <div className="rounded-lg border border-warn/40 bg-warn/15 p-3">
                  <p>
                    {shapeless.length} region{shapeless.length === 1 ? " has" : "s have"} no shape yet ({shapeless.slice(0, 8).map((r) => r.code).join(", ")}
                    {shapeless.length > 8 ? "…" : ""}). Without one, units can&apos;t walk in.
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded-md bg-accent px-3 py-1.5 text-accent-foreground disabled:opacity-50"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await fillShapesAction(gameId);
                        if (r.ok) {
                          report(true, `Gave ${r.value.filled} region${r.value.filled === 1 ? "" : "s"} a starting shape.`);
                          router.refresh();
                        } else report(false, r.error);
                      })
                    }
                  >
                    Fill in starting shapes
                  </button>
                </div>
              )}
              {terrain.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">Terrain areas</p>
                  <ul className="space-y-0.5">
                    {terrain.map((t) => {
                      const type = ruleset.terrainTypes.find((x) => x.id === t.terrainId);
                      return (
                        <li key={t.id}>
                          <button type="button" className="flex items-center gap-2 text-left text-link underline-offset-2 hover:underline" onClick={() => setSelection({ kind: "terrain", id: t.id })}>
                            <span className="h-3 w-3 rounded-sm" style={{ background: terrainColour(type) }} aria-hidden />
                            {t.name || type?.name || t.terrainId}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <p className="text-muted">
                Regions in a team&apos;s colour are owned; dark grey can&apos;t be settled; a ring is a settlement; dashed is hidden. Hatched areas are terrain. Curved dashed lines are links; red walls are
                blocked borders.
              </p>
            </div>
          )}
        </aside>
      </div>

      {csvOpen && (
        <CsvDialog
          onClose={() => setCsvOpen(false)}
          onImport={(text) =>
            startTransition(async () => {
              const r = await importRegionsAction(gameId, text);
              if (r.ok) {
                report(true, `Imported: ${r.value.created} new regions, ${r.value.updated} updated.${r.value.created ? " New regions have no shape yet: draw them, or use Fill in starting shapes." : ""}${r.value.problems.length ? ` Notes: ${r.value.problems.join(" ")}` : ""}`);
                setCsvOpen(false);
                router.refresh();
              } else report(false, r.error);
            })
          }
          pending={pending}
        />
      )}
    </div>
  );
}

/** "200 miles across": the map's scale, typed in. */
function ScaleInput({ value, onSave, pending }: { value: number; onSave: (v: number) => void; pending: boolean }) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  const n = Number(text);
  return (
    <label className="ml-auto flex items-center gap-1.5 text-sm">
      <span className="text-muted">Scale</span>
      <input type="number" min={0} className="w-24 rounded-md border border-border bg-background px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} aria-label="Miles across the map" />
      <span className="text-muted">miles across</span>
      {n > 0 && n !== value && (
        <button type="button" className="rounded-md bg-accent px-2.5 py-1 text-accent-foreground" disabled={pending} onClick={() => onSave(n)}>
          Set
        </button>
      )}
    </label>
  );
}

/** What the conversion from the old dots-and-connections map left to check, until dismissed (per browser). */
function ConversionReport({ text, gameId }: { text: string; gameId: string }) {
  const key = `map-report-dismissed:${gameId}`;
  const dismissed = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return Boolean(localStorage.getItem(key));
      } catch {
        return false;
      }
    },
    () => false,
  );
  const [hidden, setHidden] = useState(false);
  if (hidden || dismissed) return null;
  const [lead, ...items] = text.split("\n\n");
  return (
    <details className="rounded-xl border border-warn/40 bg-warn/15 p-3 text-sm">
      <summary className="cursor-pointer font-medium">{lead} Things to check ({items.length})</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((t, i) => (
          <li key={i} className="break-words">
            {t}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-2 rounded-md border border-border px-3 py-1 text-xs"
        onClick={() => {
          try {
            localStorage.setItem(key, "1");
          } catch {
            // Not remembered.
          }
          setHidden(true);
        }}
      >
        Done, hide this
      </button>
    </details>
  );
}
