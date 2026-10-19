import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Paints fog of war onto the map image on the server, so the parts of the map
// a team hasn't seen never reach its browser. Unseen areas are solid fog;
// regions seen now are cleared to their outline, regions seen before dimmed.
// A region without an outline yet gets a soft circle around its centre.

export interface FogHole {
  /** The region's outline, as fractions of the map; empty = use a circle at x, y. */
  polygon: [number, number][];
  x: number;
  y: number;
  dim: boolean;
}

const FOG = "#101014";

/** Holes for the regions a team sees now (clear) and has seen before (dimmed). */
export function fogHoles(view: { regions: { x: number; y: number; polygon: [number, number][]; state: string }[] }): FogHole[] {
  return view.regions.filter((r) => r.state !== "frontier").map((r) => ({ polygon: r.polygon, x: r.x, y: r.y, dim: r.state === "remembered" }));
}

/**
 * An SVG of the fog layer: solid everywhere except softened holes over seen
 * regions. For the height map, colour = black (unseen ground is flat) and
 * remembered regions are cleared like visible ones (hills don't change).
 */
export function fogSvg(width: number, height: number, holes: FogHole[], radiusFraction: number, opts: { colour?: string; dimClear?: boolean } = {}): string {
  const r = Math.max(8, Math.round(width * radiusFraction));
  // In the mask, white = fog shows, black = fog removed (grey = dimmed).
  const shapes = [...holes]
    .sort((a, b) => Number(b.dim) - Number(a.dim))
    .map((h) => {
      const fill = h.dim && !opts.dimClear ? "#737373" : "#000";
      if (h.polygon.length < 3) return `<circle cx="${(h.x * width).toFixed(1)}" cy="${(h.y * height).toFixed(1)}" r="${r}" fill="${fill}"/>`;
      const d = h.polygon.map(([x, y]) => `${(x * width).toFixed(1)} ${(y * height).toFixed(1)}`).join("L");
      return `<path d="M${d}Z" fill="${fill}"/>`;
    })
    .join("");
  // Clear holes drawn after dimmed ones, so a border shared by both stays clear.
  // Only the holes are softened: blurring the whole layer would thin the fog along the image's edges.
  const blur = Math.max(1, Math.round(width * 0.003));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${blur}"/></filter>
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/><g filter="url(#soft)">${shapes}</g></mask>
</defs>
<rect width="${width}" height="${height}" fill="${opts.colour ?? FOG}" mask="url(#m)"/>
</svg>`;
}

export function fogKey(assetId: string, holes: FogHole[], radiusFraction: number): string {
  const h = createHash("sha256");
  h.update(`v3|${assetId}|${radiusFraction}|`);
  for (const x of [...holes].sort((a, b) => a.x - b.x || a.y - b.y)) {
    h.update(`${x.x.toFixed(4)},${x.y.toFixed(4)},${x.dim ? 1 : 0}:${x.polygon.map(([px, py]) => `${px.toFixed(4)},${py.toFixed(4)}`).join(" ")};`);
  }
  return h.digest("hex").slice(0, 32);
}

// A few recent renders, so reloading a page doesn't redraw the fog.
const cache = new Map<string, Buffer>();
const CACHE_SIZE = 20;

export async function renderFoggedMap(key: string, image: Buffer, holes: FogHole[], radiusFraction: number): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) return hit;
  const base = sharp(image);
  const meta = await base.metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const fog = Buffer.from(fogSvg(width, height, holes, radiusFraction));
  const out = await base
    .composite([{ input: fog, top: 0, left: 0 }])
    .webp({ quality: 80 })
    .toBuffer();
  cache.set(key, out);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return out;
}

/** The height map with unseen ground flattened, so its shape never reaches the browser. */
export async function renderFoggedHeight(key: string, image: Buffer, holes: FogHole[], radiusFraction: number): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) return hit;
  const base = sharp(image).greyscale();
  const meta = await base.metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const fog = Buffer.from(fogSvg(width, height, holes, radiusFraction, { colour: "#000", dimClear: true }));
  const out = await base.composite([{ input: fog, top: 0, left: 0 }]).png().toBuffer();
  cache.set(key, out);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return out;
}
