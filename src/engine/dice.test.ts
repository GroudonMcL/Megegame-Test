import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "./rng";
import { describeRoll, parseDice, rollDice } from "./dice";

/** An Rng that returns the given die faces in order (for exact tests). */
function scripted(faces: number[]): Rng {
  let i = 0;
  return {
    seed: "scripted",
    next: () => 0,
    int: (min, max) => {
      const v = faces[i++];
      if (v === undefined || v < min || v > max) throw new Error(`scripted face ${v} out of ${min}..${max}`);
      return v;
    },
  };
}

describe("parseDice", () => {
  it("reads common expressions", () => {
    expect(parseDice("d20")).toEqual([{ kind: "dice", count: 1, sides: 20, sign: 1 }]);
    expect(parseDice("2d6+3")).toEqual([
      { kind: "dice", count: 2, sides: 6, sign: 1 },
      { kind: "flat", value: 3, sign: 1 },
    ]);
    expect(parseDice("2d20kh1")[0]).toMatchObject({ keep: { mode: "highest", n: 1 } });
    expect(parseDice("1d8 - 1")[1]).toEqual({ kind: "flat", value: 1, sign: -1 });
  });

  it("rejects nonsense", () => {
    for (const bad of ["", "d", "2x6", "3d6kh4", "d0", "2d6++3", "abc"]) {
      expect(() => parseDice(bad), bad).toThrow();
    }
  });
});

describe("rollDice", () => {
  it("adds dice and modifiers", () => {
    const r = rollDice("2d6+3", scripted([4, 5]));
    expect(r.total).toBe(12);
    expect(describeRoll(r)).toBe("2d6 (4, 5) + 3 = 12");
  });

  it("handles advantage and disadvantage", () => {
    expect(rollDice("2d20kh1", scripted([7, 15])).total).toBe(15);
    expect(rollDice("2d20kl1", scripted([7, 15])).total).toBe(7);
    expect(describeRoll(rollDice("2d20kh1", scripted([7, 15])))).toBe("2d20kh1 (7, 15 → kept 15) = 15");
  });

  it("handles negative terms", () => {
    const r = rollDice("1d8-1", scripted([1]));
    expect(r.total).toBe(0);
    expect(describeRoll(r)).toBe("1d8 (1) - 1 = 0");
  });

  it("is reproducible from a seed", () => {
    expect(rollDice("4d6kh3", createRng("s")).total).toBe(rollDice("4d6kh3", createRng("s")).total);
  });
});
