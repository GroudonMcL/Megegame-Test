import { FLAT, type HeightField } from "./heightField";

// Browser-only helpers for the 3D map: reading the height map into a height
// field, and painting the map (image plus everything the 2D map draws over it)
// into a canvas that is draped over the ground.

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });

/** At most this many samples across: plenty for the mesh, quick to read. */
const MAX_SAMPLES = 512;

export async function loadHeightField(url: string | null): Promise<HeightField> {
  if (!url) return FLAT;
  const img = await loadImage(url);
  const k = Math.min(1, MAX_SAMPLES / Math.max(img.naturalWidth, img.naturalHeight));
  const cols = Math.max(2, Math.round(img.naturalWidth * k));
  const rows = Math.max(2, Math.round(img.naturalHeight * k));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const data = new Float32Array(cols * rows);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
  return { cols, rows, data };
}

/**
 * The SVG as a standalone picture. An SVG drawn as an image can't see the
 * page's CSS, so colours given as var(--x) are looked up and written in.
 */
export function standaloneSvg(svg: SVGSVGElement): string {
  const style = getComputedStyle(svg);
  const text = new XMLSerializer().serializeToString(svg);
  return text.replace(/var\((--[\w-]+)\)/g, (_, name: string) => style.getPropertyValue(name).trim() || "transparent");
}

let lastImage: { url: string; img: Promise<HTMLImageElement> } | null = null;
/** The map image, kept while its URL stays the same (it changes with the fog). */
function mapImage(url: string) {
  if (lastImage?.url !== url) lastImage = { url, img: loadImage(url) };
  return lastImage.img;
}

/** Paints the ground: background colour, the map image (if any), then the drawn layers. */
export async function paintGround(canvas: HTMLCanvasElement, opts: { imageUrl?: string | null; svg: string; background: string }) {
  const [img, layers] = await Promise.all([
    opts.imageUrl ? mapImage(opts.imageUrl).catch(() => null) : Promise.resolve(null),
    loadImage(URL.createObjectURL(new Blob([opts.svg], { type: "image/svg+xml" }))),
  ]);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(layers, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(layers.src);
}

/** Can this browser draw 3D at all? */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
