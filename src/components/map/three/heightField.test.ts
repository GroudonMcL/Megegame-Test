import { describe, expect, it } from "vitest";
import { densify, distToLine, FLAT, intersectGround, sampleHeight, toWorld, type HeightField } from "./heightField";

// A 3×3 field with a peak in the middle.
const peak: HeightField = { cols: 3, rows: 3, data: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]) };

describe("height field", () => {
  it("samples between points", () => {
    expect(sampleHeight(peak, 0.5, 0.5)).toBe(1);
    expect(sampleHeight(peak, 0.25, 0.5)).toBeCloseTo(0.5);
    expect(sampleHeight(peak, 0, 0)).toBe(0);
    expect(sampleHeight(FLAT, 0.3, 0.7)).toBe(0);
  });

  it("places map points in the world", () => {
    expect(toWorld(peak, 0.1, 0.5, [0.5, 0.5])).toEqual([0, 0.1, 0]);
    expect(toWorld(FLAT, 0.1, 0.5, [0, 1])).toEqual([-0.5, 0, 0.25]);
  });

  it("finds where a ray from above meets the ground, and the hill in the way of a low one", () => {
    // Straight down onto a flat map.
    const down = intersectGround(FLAT, 0, 1, [0.2, 2, -0.1], [0, -1, 0]);
    expect(down![0]).toBeCloseTo(0.7);
    expect(down![1]).toBeCloseTo(0.4);
    // A low ray from the left aimed at the far right edge hits the peak's slope first.
    const dir: [number, number, number] = [1, -0.02, 0];
    const len = Math.hypot(...dir);
    const hit = intersectGround(peak, 0.2, 1, [-0.6, 0.05, 0], [dir[0] / len, dir[1] / len, 0]);
    expect(hit![0]).toBeLessThan(0.5);
    expect(hit![0]).toBeGreaterThan(0.05);
    // Pointing at the sky.
    expect(intersectGround(FLAT, 0, 1, [0, 1, 0], [0, 1, 0])).toBeNull();
  });

  it("measures distance to a line and splits lines up", () => {
    expect(distToLine([0.5, 0.1], [[0, 0], [1, 0]], 1)).toBeCloseTo(0.1);
    expect(densify([[0, 0], [1, 0]], 0.25, 1)).toHaveLength(5);
  });
});
