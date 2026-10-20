import "server-only";
import { createHash } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";

// Paints fog of war onto the map image on the server, so the parts of the map
// a team hasn't seen never reach its browser. Unseen areas are solid fog;
// regions seen now are cleared to their outline, regions seen before dimmed,
// and glimpsed regions (next to a seen one) shown in greyscale under light fog.
// A region without an outline yet gets a soft circle around its centre.

export interface FogHole {
  /** The region's outline, as fractions of the map; empty = use a circle at x, y. */
  polygon: [number, number][];
  x: number;
  y: number;
  dim: boolean;
  /** A glimpsed region: shown in greyscale. */
  grey?: boolean;
}

const FOG = "#101014";
/** Luminance weights, applied to all three channels so the image stays RGB. */
const GREY_ROW: [number, number, number] = [0.299, 0.587, 0.114];
const GREYSCALE: [[number, number, number], [number, number, number], [number, number, number]] = [GREY_ROW, GREY_ROW, GREY_ROW];

/** Holes for the regions a team sees now (clear), has seen before (dimmed) and glimpses (greyscale). */
export function fogHoles(view: { regions: { x: number; y: number; polygon: [number, number][]; state: string }[] }): FogHole[] {
  return view.regions
    .filter((r) => r.state !== "frontier")
    .map((r) => ({ polygon: r.polygon, x: r.x, y: r.y, dim: r.state === "remembered", ...(r.state === "glimpsed" ? { grey: true } : {}) }));
}

/** Clear holes win over dimmed ones, and dimmed over greyscale, where they meet. */
const rank = (h: FogHole) => (h.grey ? 0 : h.dim ? 1 : 2);

function holeShape(h: FogHole, width: number, height: number, radius: number, fill: string): string {
  if (h.polygon.length < 3) return `<circle cx="${(h.x * width).toFixed(1)}" cy="${(h.y * height).toFixed(1)}" r="${radius}" fill="${fill}"/>`;
  const d = h.polygon.map(([x, y]) => `${(x * width).toFixed(1)} ${(y * height).toFixed(1)}`).join("L");
  return `<path d="M${d}Z" fill="${fill}"/>`;
}

const softBlur = (width: number) => Math.max(1, Math.round(width * 0.003));

/**
 * An SVG of the fog layer: solid everywhere except softened holes over seen
 * regions. For the height map, colour = black (unseen ground is flat) and
 * remembered and glimpsed regions are cleared like visible ones (their hills show).
 */
export function fogSvg(width: number, height: number, holes: FogHole[], radiusFraction: number, opts: { colour?: string; dimClear?: boolean } = {}): string {
  const r = Math.max(8, Math.round(width * radiusFraction));
  // In the mask, white = fog shows, black = fog removed (grey = dimmed).
  const shapes = [...holes]
    .sort((a, b) => rank(a) - rank(b))
    .map((h) => holeShape(h, width, height, r, opts.dimClear ? "#000" : h.grey ? "#3a3a3a" : h.dim ? "#737373" : "#000"))
    .join("");
  // Clear holes drawn after dimmed ones, so a border shared by both stays clear.
  // Only the holes are softened: blurring the whole layer would thin the fog along the image's edges.
  const blur = softBlur(width);
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
  h.update(`v4|${assetId}|${radiusFraction}|`);
  for (const x of [...holes].sort((a, b) => a.x - b.x || a.y - b.y)) {
    h.update(`${x.x.toFixed(4)},${x.y.toFixed(4)},${x.dim ? 1 : 0}${x.grey ? "g" : ""}:${x.polygon.map(([px, py]) => `${px.toFixed(4)},${py.toFixed(4)}`).join(" ")};`);
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
  const grey = holes.filter((x) => x.grey);
  const layers: OverlayOptions[] = [];
  if (grey.length) {
    // A greyscale copy of the image, cut to the glimpsed regions, goes under the fog.
    const r = Math.max(8, Math.round(width * radiusFraction));
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${softBlur(width)}"/></filter></defs><g filter="url(#soft)">${grey.map((x) => holeShape(x, width, height, r, "#fff")).join("")}</g></svg>`;
    // Two passes: sharp composites last, so the cut has to come after the greyscale is made.
    const greyAll = await sharp(image).removeAlpha().recomb(GREYSCALE).ensureAlpha().png().toBuffer();
    const greyImage = await sharp(greyAll)
      .composite([{ input: Buffer.from(mask), blend: "dest-in" }])
      .png()
      .toBuffer();
    layers.push({ input: greyImage, top: 0, left: 0 });
  }
  layers.push({ input: fog, top: 0, left: 0 });
  const out = await base.composite(layers).webp({ quality: 80 }).toBuffer();
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
