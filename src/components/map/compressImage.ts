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
