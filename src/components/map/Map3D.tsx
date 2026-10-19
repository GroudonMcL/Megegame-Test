"use client";

import { Line, MapControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CanvasTexture, PlaneGeometry, SRGBColorSpace, Vector2, Vector3, type Camera } from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { indexShapes, regionAt } from "@/engine/geo/regions";
import { lightFactor, sunDirection, type MapLook } from "@/engine/world/mapLook";
import { MapLayers, type MapCanvasProps } from "./MapCanvas";
import { densify, distToLine, FLAT, intersectGround, toWorld, type HeightField, type Pt } from "./three/heightField";
import { loadHeightField, paintGround, standaloneSvg } from "./three/mapTexture";

// The 3D map: the ground is the height map, draped with the map image and
// everything the 2D map draws over it (regions, terrain, borders, labels,
// planned routes). Unit stacks stand on it as small badges. It takes the same
// props as the 2D map and reports the same clicks and drags, so the screens
// using it don't need to know which one is showing. Only loaded when 3D is on
// (three.js is big), and it gives up (onSlow) on devices that can't keep up.

export interface Map3DExtras {
  /** SVG drawn onto the ground over the map layers (e.g. planned routes), given the drawing scale. */
  drape?: (scale: number) => ReactNode;
  /** Things standing on the map (unit stacks). They may carry data-handle, or data-node-id with data-badge, like the 2D overlay. */
  tokens?: { key: string; at: Pt; content: ReactNode }[];
  /** Lines just above the ground (the move being planned). */
  lines?: { key: string; points: Pt[]; colour: string; dashed?: boolean }[];
  /** Lines on the ground that can be clicked (reported as a click on that handle). */
  hitLines?: { handle: string; points: Pt[] }[];
}

export interface Map3DProps extends MapCanvasProps, Map3DExtras {
  heightUrl: string | null;
  look: MapLook;
  /** The device can't draw 3D smoothly enough. */
  onSlow?: () => void;
}

const CLICK_SLOP = 5;
/** The camera's starting tilt from straight down. */
const TILT = 0.75;

export default function Map3D(props: Map3DProps) {
  const { width, height, look } = props;
  const aspect = height / width;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraRef = useRef<Camera | null>(null);
  const controlsRef = useRef<MapControlsImpl | null>(null);
  const [field, setField] = useState<HeightField>(FLAT);
  const [frameloop, setFrameloop] = useState<"always" | "demand">("always");
  const [fitKey, setFitKey] = useState(0);

  // The height map.
  useEffect(() => {
    let live = true;
    loadHeightField(props.heightUrl)
      .catch(() => FLAT)
      .then((f) => live && setField(f));
    return () => {
      live = false;
    };
  }, [props.heightUrl]);

  // The picture draped over the ground: drawn as SVG (hidden, below), then painted into a canvas.
  const texSize = useMemo(() => {
    const long = 3072;
    return width >= height ? { w: long, h: Math.round(long * aspect) } : { w: Math.round(long / aspect), h: long };
  }, [width, height, aspect]);
  const drawScale = (width / texSize.w) * 1.8;
  const [texture] = useState(() => {
    const c = document.createElement("canvas");
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
  const [texVersion, setTexVersion] = useState(0);
  const lastSvg = useRef("");
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const text = standaloneSvg(svg);
    const key = `${text}|${props.imageUrl}`;
    if (key === lastSvg.current) return;
    lastSvg.current = key;
    const canvas = texture.image as HTMLCanvasElement;
    if (canvas.width !== texSize.w || canvas.height !== texSize.h) {
      canvas.width = texSize.w;
      canvas.height = texSize.h;
    }
    const background = getComputedStyle(svg).getPropertyValue("--map-region").trim() || "#2a2f3a";
    let live = true;
    void paintGround(canvas, { imageUrl: props.imageUrl, svg: text, background }).then(() => {
      if (!live || lastSvg.current !== key) return;
      texture.needsUpdate = true;
      setTexVersion((v) => v + 1);
    });
    return () => {
      live = false;
    };
  });

  // Regions by shape, for working out what was clicked.
  const shapes = useMemo(() => indexShapes(props.nodes.filter((n) => n.polygon && n.polygon.length >= 3).map((n) => ({ id: n.id, polygon: n.polygon! }))), [props.nodes]);

  /** The map point under the pointer, or null (sky). */
  const pick = (clientX: number, clientY: number): Pt | null => {
    const cam = cameraRef.current;
    const el = wrapRef.current;
    if (!cam || !el) return null;
    const rect = el.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const origin = new Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(cam).sub(origin).normalize();
    return intersectGround(field, look.relief, aspect, [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z]);
  };

  // Pointer gestures, the same as the 2D map: drag a handle, click a badge, click the ground.
  const gesture = useRef<
    | { kind: "handle"; id: string; x: number; y: number; moved: boolean; button: number; shift: boolean }
    | { kind: "badge"; id: string; badge?: string; x: number; y: number; moved: boolean; shift: boolean }
    | { kind: "ground"; x: number; y: number; moved: boolean; shift: boolean }
    | null
  >(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as Element;
    const handle = t.closest("[data-handle]")?.getAttribute("data-handle");
    const node = t.closest("[data-node-id]");
    if (handle) {
      gesture.current = { kind: "handle", id: handle, x: e.clientX, y: e.clientY, moved: false, button: e.button, shift: e.shiftKey };
      wrapRef.current?.setPointerCapture(e.pointerId);
    } else if (node) {
      gesture.current = { kind: "badge", id: node.getAttribute("data-node-id")!, badge: node.getAttribute("data-badge") ?? undefined, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey };
    } else {
      gesture.current = { kind: "ground", x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (props.onHover && (!g || g.kind === "handle")) props.onHover(pick(e.clientX, e.clientY));
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < CLICK_SLOP) return;
    g.moved = true;
    if (g.kind === "handle") {
      const p = pick(e.clientX, e.clientY);
      if (p) props.onHandleMove?.(g.id, p, false);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "handle") {
      wrapRef.current?.releasePointerCapture(e.pointerId);
      const p = pick(e.clientX, e.clientY);
      if (g.moved) {
        if (p) props.onHandleMove?.(g.id, p, true);
      } else props.onHandleClick?.(g.id, { button: g.button, shiftKey: g.shift });
      return;
    }
    if (g.moved) return;
    const p = pick(e.clientX, e.clientY);
    if (g.kind === "badge") {
      if (p) props.onPointClick?.(p);
      props.onNodeClick?.(g.id, { shiftKey: g.shift || e.shiftKey, badge: g.badge });
      return;
    }
    if (!p) return;
    props.onPointClick?.(p);
    // A route on the ground? (About 10 pixels at this zoom.)
    const cam = cameraRef.current;
    const target = controlsRef.current?.target;
    const tol = cam && target ? cam.position.distanceTo(target) * 0.012 : 0.01;
    const line = props.hitLines?.find((l) => distToLine(p, l.points, aspect) < tol);
    if (line && props.onHandleClick) return props.onHandleClick(line.handle, { button: e.button, shiftKey: e.shiftKey });
    const region = regionAt(shapes, p);
    if (region) props.onNodeClick?.(region, { shiftKey: g.shift || e.shiftKey });
    else props.onBackgroundClick?.(p[0], p[1]);
  };

  const tokenEls = useRef(new Map<string, HTMLDivElement>());
  const tokens = (props.tokens ?? []).map((t) => ({ key: t.key, pos: toWorld(field, look.relief, aspect, t.at, 0.002) }));

  // Light: dimmed by darkness; the sun is a point light far above the map, in its direction.
  const f = lightFactor(look);
  const [sx, sy, sz] = sunDirection(look);
  const sun = new Vector3(sx, sy, sz).multiplyScalar(2.5);

  const focusNode = props.focus && props.nodes.find((x) => x.id === props.focus!.nodeId);
  const focus = props.focus && focusNode ? { at: [focusNode.x, focusNode.y] as Pt, key: props.focus.key } : null;

  // Fit the view: the regions given (or the whole map), from above at a tilt.
  const box = useMemo(() => {
    const pts = props.fitToNodes && props.nodes.length ? props.nodes.map((n) => [n.x, n.y] as Pt) : ([[0, 0], [1, 1]] as Pt[]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(Math.max(...xs) - Math.min(...xs), 0.2), h: Math.max(Math.max(...ys) - Math.min(...ys), 0.2) };
  }, [props.fitToNodes, props.nodes]);

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden ${props.bare ? "" : "rounded-xl border border-border bg-background"} ${props.className ?? "h-[70vh]"} touch-none select-none`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (gesture.current = null)}
      onPointerLeave={() => props.onHover?.(null)}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Map (3D)"
    >
      {/* The layers to drape, drawn as SVG the size of the texture (never shown). */}
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={texSize.w} height={texSize.h} viewBox={`0 0 ${width} ${height}`} className="pointer-events-none invisible absolute h-0 w-0" aria-hidden>
        <MapLayers {...props} scale={drawScale} renderNodeExtras={undefined} />
        {props.drape?.(drawScale)}
      </svg>
      <Canvas
        frameloop={frameloop}
        flat
        shadows={look.shadows ? "percentage" : false}
        dpr={[1, 2]}
        camera={{ fov: 40, near: 0.005, far: 20, position: [0, 1.2, 0.9] }}
        onCreated={({ camera }) => {
          cameraRef.current = camera;
        }}
      >
        <color attach="background" args={[skyColour(look)]} />
        <ambientLight color={look.ambientColour} intensity={look.ambientIntensity * f * Math.PI} />
        <pointLight
          position={sun}
          color={look.sunColour}
          intensity={look.sunIntensity * f * Math.PI}
          decay={0}
          castShadow={look.shadows}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.002}
          shadow-camera-near={0.5}
          shadow-camera-far={6}
        />
        <Ground field={field} relief={look.relief} aspect={aspect} texture={texture} version={texVersion} shadows={look.shadows} />
        <TokenPlacer tokens={tokens} elements={tokenEls} />
        {props.lines?.map((l) =>
          l.points.length > 1 ? (
            <Line
              key={l.key}
              points={densify(l.points, 0.004, aspect).map((p) => toWorld(field, look.relief, aspect, p, 0.003))}
              color={cssColour(l.colour)}
              lineWidth={3}
              dashed={l.dashed}
              dashSize={0.008}
              gapSize={0.005}
              depthTest={false}
              renderOrder={10}
            />
          ) : null,
        )}
        <Controls
          controlsRef={controlsRef}
          aspect={aspect}
          box={box}
          fitKey={fitKey}
          focus={focus}
          field={field}
          relief={look.relief}
        />
        {frameloop === "always" && (
          <SpeedCheck
            onDone={(fps) => {
              setFrameloop("demand");
              if (fps < 15) props.onSlow?.();
            }}
          />
        )}
      </Canvas>
      {/* Tokens: ordinary page elements, moved over the canvas to where their spot is on screen. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {props.tokens?.map((t) => (
          <div
            key={t.key}
            ref={(el) => {
              if (el) tokenEls.current.set(t.key, el);
              else tokenEls.current.delete(t.key);
            }}
            className="absolute top-0 left-0 will-change-transform"
            style={{ visibility: "hidden" }}
          >
            {t.content}
          </div>
        ))}
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1">
        <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-sm shadow hover:border-border-strong" onClick={() => zoom(0.7)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-sm shadow hover:border-border-strong" onClick={() => zoom(1.4)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="glass rounded-lg border border-border px-2.5 py-1 text-xs shadow hover:border-border-strong" onClick={() => setFitKey((k) => k + 1)}>
          Fit
        </button>
      </div>
    </div>
  );

  function zoom(k: number) {
    const c = controlsRef.current;
    const cam = cameraRef.current;
    if (!c || !cam) return;
    const offset = cam.position.clone().sub(c.target).multiplyScalar(k);
    const len = Math.min(Math.max(offset.length(), c.minDistance), c.maxDistance);
    cam.position.copy(c.target).add(offset.setLength(len));
    c.update();
  }
}

/** A colour given as var(--x), looked up in the page's CSS (three.js can't read CSS variables). */
function cssColour(c: string) {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#ffffff" : c;
}

/** The sky behind the map: dark blue-grey, darker at night. */
function skyColour(look: MapLook) {
  const k = 1 - 0.8 * look.darkness;
  const c = (v: number) =>
    Math.round(v * k)
      .toString(16)
      .padStart(2, "0");
  return `#${c(0x16)}${c(0x1c)}${c(0x2a)}`;
}

/** The ground mesh: a grid raised by the height field, with the map painted on. */
function Ground({ field, relief, aspect, texture, version, shadows }: { field: HeightField; relief: number; aspect: number; texture: CanvasTexture; version: number; shadows: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => {
    const cols = field.cols > 1 ? Math.min(256, field.cols - 1) : 1;
    const rows = field.cols > 1 ? Math.max(1, Math.round(cols * aspect)) : 1;
    const g = new PlaneGeometry(1, aspect, cols, rows);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = toWorld(field, relief, aspect, [pos.getX(i) + 0.5, (pos.getZ(i) + aspect / 2) / aspect]);
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }, [field, relief, aspect]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => invalidate(), [version, invalidate]);
  return (
    <mesh geometry={geometry} castShadow={shadows} receiveShadow={shadows}>
      <meshStandardMaterial map={texture} roughness={0.95} metalness={0} />
    </mesh>
  );
}

/**
 * Pan (left drag, one finger), turn and tilt (right drag, two fingers), zoom
 * (wheel, pinch). The view can't tilt to the horizon or wander off the map.
 */
function Controls({
  controlsRef,
  aspect,
  box,
  fitKey,
  focus,
  field,
  relief,
}: {
  controlsRef: React.RefObject<MapControlsImpl | null>;
  aspect: number;
  box: { cx: number; cy: number; w: number; h: number };
  fitKey: number;
  focus: { at: Pt; key: number } | null;
  field: HeightField;
  relief: number;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const viewAspect = useThree((s) => s.size.width / Math.max(1, s.size.height));

  // Fit on first show and when asked.
  useLayoutEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const target = new Vector3(...toWorld(field, relief, aspect, [box.cx, box.cy]));
    // Far enough back to see the box across (and down, on a tall screen).
    const span = Math.max(box.w, (box.h * aspect) * viewAspect) * 1.25;
    const dist = Math.min(Math.max(span * 1.05, 0.15), 2.4);
    c.target.copy(target);
    camera.position.set(target.x, target.y + dist * Math.cos(TILT), target.z + dist * Math.sin(TILT));
    c.update();
    invalidate();
    // Only on first show and Fit; not when heights or the box change while playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Centre on a region when asked, keeping the angle and zoom.
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    const c = controlsRef.current;
    if (!c || !focus || focus.key === seen) return;
    setSeen(focus.key);
    const to = new Vector3(...toWorld(field, relief, aspect, focus.at));
    camera.position.add(to.clone().sub(c.target));
    c.target.copy(to);
    c.update();
    invalidate();
  }, [focus, seen, controlsRef, camera, field, relief, aspect, invalidate]);

  return (
    <MapControls
      ref={controlsRef}
      makeDefault
      maxPolarAngle={1.2}
      minDistance={0.03}
      maxDistance={2.5}
      screenSpacePanning={false}
      onChange={() => {
        // Keep the point being looked at over the map.
        const c = controlsRef.current;
        if (!c) return;
        const x = Math.min(Math.max(c.target.x, -0.5), 0.5);
        const z = Math.min(Math.max(c.target.z, -aspect / 2), aspect / 2);
        if (x !== c.target.x || z !== c.target.z) {
          c.object.position.x += x - c.target.x;
          c.object.position.z += z - c.target.z;
          c.target.x = x;
          c.target.z = z;
        }
      }}
    />
  );
}

/**
 * Puts each token's element where its spot is on screen, whenever a frame is
 * drawn (the camera moved, or something changed). Centred on the spot; hidden
 * when the spot is behind the camera.
 */
function TokenPlacer({ tokens, elements }: { tokens: { key: string; pos: [number, number, number] }[]; elements: React.RefObject<Map<string, HTMLDivElement>> }) {
  const v = useMemo(() => new Vector3(), []);
  const invalidate = useThree((s) => s.invalidate);
  // New or moved tokens need a frame to be placed.
  useEffect(() => invalidate(), [tokens, invalidate]);
  useFrame(({ camera, size }) => {
    for (const t of tokens) {
      const el = elements.current.get(t.key);
      if (!el) continue;
      v.set(...t.pos).project(camera);
      if (v.z > 1) {
        el.style.visibility = "hidden";
        continue;
      }
      const x = ((v.x + 1) / 2) * size.width - el.offsetWidth / 2;
      const y = ((1 - v.y) / 2) * size.height - el.offsetHeight / 2;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = "visible";
    }
  });
  return null;
}

/** Measures the frame rate for a few seconds after a short warm-up, then reports it. */
function SpeedCheck({ onDone }: { onDone: (fps: number) => void }) {
  const t = useRef({ start: 0, frames: 0, done: false });
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const s = t.current;
    if (s.done || now < 0.6) return;
    if (!s.start) s.start = now;
    s.frames++;
    if (now - s.start >= 2.5) {
      s.done = true;
      onDone(s.frames / (now - s.start));
    }
  });
  return null;
}
