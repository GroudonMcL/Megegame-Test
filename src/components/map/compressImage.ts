// Shrinks an image in the browser before upload so it fits under the server's
// 4 MB limit: longest side at most 4096 px, saved as WebP (or JPEG).

const MAX_SIDE = 4096;
const MAX_BYTES = 3.8 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let quality = 0.9;
  for (let attempt = 0; attempt < 8; attempt++) {
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= MAX_BYTES) return { blob, width, height };
    if (quality > 0.65) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error("Couldn't shrink the image enough. Try a smaller one.");
}

/** Height maps are stored at most this wide or tall (the server keeps the same size). */
const HEIGHT_SIDE = 1024;

/**
 * Shrinks a height map in the browser before upload, so big exports from
 * terrain tools (16-bit PNGs of many megabytes) fit under the server's limit.
 * Saved as a greyscale PNG: lossless, so no banding is added.
 */
export async function shrinkHeightMap(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't read that image. Save it as a PNG or JPEG and try again.");
  }
  for (let side = HEIGHT_SIDE; side >= 256; side = Math.round(side * 0.75)) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Grey only (red, green and blue the same), which also makes the PNG much smaller.
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
      px[i] = px[i + 1] = px[i + 2] = g;
      px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await toBlob(canvas, "image/png", 1);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("Couldn't shrink the height map enough. Try a smaller image.");
}
