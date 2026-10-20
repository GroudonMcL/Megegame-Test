import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { fogHoles, renderFoggedHeight, renderFoggedMap } = await import("./fogImage");

// A 100×100 height map, all mid-grey (128). Left half seen now, top-right seen before, bottom-right never.
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("fogged height map", () => {
  it("flattens unseen ground and keeps the hills of regions seen now or before", async () => {
    const grey = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();
    const out = await renderFoggedHeight(
      "test",
      grey,
      [
        { polygon: square(0, 0, 0.5, 1), x: 0.25, y: 0.5, dim: false },
        { polygon: square(0.5, 0, 1, 0.5), x: 0.75, y: 0.25, dim: true },
      ],
      0.05,
    );
    const { data, info } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(at(20, 50)).toBeGreaterThan(120);
    expect(at(80, 20)).toBeGreaterThan(120);
    expect(at(80, 80)).toBeLessThan(8);
  });
});

describe("fogged map image", () => {
  it("clears regions seen now, greys glimpsed ones and fogs the rest", async () => {
    const red = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
    const holes = fogHoles({
      regions: [
        { polygon: square(0, 0, 0.5, 1), x: 0.25, y: 0.5, state: "visible" },
        { polygon: square(0.5, 0, 1, 0.5), x: 0.75, y: 0.25, state: "glimpsed" },
        { polygon: square(0.5, 0.5, 1, 1), x: 0.75, y: 0.75, state: "frontier" },
      ],
    });
    expect(holes.map((h) => Boolean(h.grey))).toEqual([false, true]);
    const out = await renderFoggedMap("test-map", red, holes, 0.05);
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
    const [r1, g1] = at(20, 50);
    expect(r1).toBeGreaterThan(180);
    expect(g1).toBeLessThan(70);
    // Glimpsed: grey (no colour), still lighter than fog.
    const [r2, g2, b2] = at(80, 20);
    expect(Math.abs(r2 - g2)).toBeLessThan(8);
    expect(Math.abs(g2 - b2)).toBeLessThan(8);
    expect(r2).toBeGreaterThan(40);
    // Unexplored: solid fog.
    expect(Math.max(...at(80, 80))).toBeLessThan(30);
  });
});
