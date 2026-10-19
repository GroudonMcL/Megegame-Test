// Colour maths for checking and fixing text contrast (WCAG 2 formulas).

export type Rgb = [number, number, number];

/** "#1a2b3c" or "rgb(1 2 3 / 0.5)" → [r, g, b] and alpha. */
export function parseColour(c: string): { rgb: Rgb; alpha: number } {
  const s = c.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
    const n = parseInt(h, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/i.exec(s);
  if (fn) return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alpha: fn[4] === undefined ? 1 : Number(fn[4]) };
  throw new Error(`Can't read colour ${c}`);
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes a towards b by t (0 = a, 1 = b). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A colour with transparency painted over an opaque one. */
export function over(top: string, under: Rgb): Rgb {
  const { rgb, alpha } = parseColour(top);
  return mix(under, rgb, alpha);
}

export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** Black or white, whichever reads better on this colour (always at least 4.58:1). */
export function textOn(bg: Rgb): Rgb {
  return contrast(bg, WHITE) >= contrast(bg, BLACK) ? WHITE : BLACK;
}

/**
 * The colour, lightened (on a dark background) or darkened (on a light one)
 * just enough to read as text on that background.
 */
export function readableOn(colour: Rgb, bg: Rgb, min = 4.5): Rgb {
  const target = luminance(bg) < 0.5 ? WHITE : BLACK;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    // Rounded, so the check holds for the hex colour that's actually used.
    const c = mix(colour, target, t).map(Math.round) as Rgb;
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}
