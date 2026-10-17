import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRng("round-3-slot-1");
    const b = createRng("round-3-slot-1");
    const seqA = Array.from({ length: 20 }, () => a.int(1, 20));
    const seqB = Array.from({ length: 20 }, () => b.int(1, 20));
    expect(seqA).toEqual(seqB);
  });

  it("gives different sequences for different seeds", () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.int(1, 1000))(createRng("a")));
    const b = Array.from({ length: 20 }, ((r) => () => r.int(1, 1000))(createRng("b")));
    expect(a).not.toEqual(b);
  });

  it("stays within range and hits every face of a d20", () => {
    const rng = createRng("coverage");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(1, 20);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      seen.add(v);
    }
    expect(seen.size).toBe(20);
  });

  it("is roughly uniform", () => {
    const rng = createRng("uniform");
    const counts = new Array(6).fill(0);
    const n = 60000;
    for (let i = 0; i < n; i++) counts[rng.int(1, 6) - 1]++;
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n / 6 * 0.05);
  });

  it("rejects bad ranges", () => {
    expect(() => createRng("x").int(5, 1)).toThrow();
  });
});
