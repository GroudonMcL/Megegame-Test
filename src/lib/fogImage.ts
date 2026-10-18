import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Paints fog of war onto the map image on the server, so the parts of the map
// a team hasn't seen never reach its browser. Unseen areas are solid fog;
// regions seen now get a clear circle, regions seen before a dimmed one.

export interface FogHole {
  /** Position as fractions of the map's width and height. */
  x: number;
  y: number;
  dim: boolean;
}

const FOG = "#101014";

/** Clear circles for the regions a team sees now, dimmed ones for regions seen before. */
export function fogHoles(view: { regions: { x: number; y: number; state: string }[] }): FogHole[] {
  return view.regions.filter((r) => r.state !== "frontier").map((r) => ({ x: r.x, y: r.y, dim: r.state === "remembered" }));
}

/** An SVG of the fog layer: solid everywhere except soft holes around seen regions. */
export function fogSvg(width: number, height: number, holes: FogHole[], radiusFraction: number): string {
  const r = Math.max(8, Math.round(width * radiusFraction));
  // In the mask, white = fog shows, black = fog removed.
  const circles = holes
    .map((h) => `<circle cx="${(h.x * width).toFixed(1)}" cy="${(h.y * height).toFixed(1)}" r="${r}" fill="url(#${h.dim ? "dim" : "clear"})"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<radialGradient id="clear"><stop offset="0.6" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="dim"><stop offset="0.6" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${circles}</mask>
</defs>
<rect width="${width}" height="${height}" fill="${FOG}" mask="url(#m)"/>
</svg>`;
}

export function fogKey(assetId: string, holes: FogHole[], radiusFraction: number): string {
  const h = createHash("sha256");
  h.update(`${assetId}|${radiusFraction}|`);
  for (const x of [...holes].sort((a, b) => a.x - b.x || a.y - b.y)) h.update(`${x.x.toFixed(4)},${x.y.toFixed(4)},${x.dim ? 1 : 0};`);
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
