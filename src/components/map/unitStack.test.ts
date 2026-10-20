import { describe, expect, it } from "vitest";
import { dragUnits, isGreyed, pruneSelection, radialSlots, RADIAL_MAX, selectedAmong, toggleUnit, type StackEntry } from "./unitStack";

const entry = (id: string, movable = true): StackEntry => ({ id, name: id, detail: "", owner: null, movable });
const stack = [entry("a"), entry("b"), entry("lent"), entry("theirs", false), entry("wild", false)];

describe("the units at one spot", () => {
  it("drags every unit that can move when none are ticked", () => {
    expect(dragUnits(stack, new Set())).toEqual(["a", "b", "lent"]);
  });

  it("drags only the ticked units (the stack splits)", () => {
    expect(dragUnits(stack, new Set(["b", "lent"]))).toEqual(["b", "lent"]);
    // A tick on a unit that can't move counts for nothing.
    expect(dragUnits(stack, new Set(["theirs"]))).toEqual(["a", "b", "lent"]);
    expect(dragUnits([entry("x", false)], new Set())).toEqual([]);
  });

  it("only ticks units the viewer can move", () => {
    const one = toggleUnit(new Set(), stack[0]);
    expect([...one]).toEqual(["a"]);
    expect([...toggleUnit(one, stack[0])]).toEqual([]);
    expect([...toggleUnit(one, stack[3])]).toEqual(["a"]);
  });

  it("greys out units the viewer can't move, and unticked ones once some are ticked", () => {
    expect(isGreyed(stack[3], new Set())).toBe(true);
    expect(isGreyed(stack[0], new Set())).toBe(false);
    expect(isGreyed(stack[0], new Set(["b"]))).toBe(true);
    expect(isGreyed(stack[1], new Set(["b"]))).toBe(false);
  });

  it("keeps the selection per spot and drops units that moved away", () => {
    const sel = new Set(["a", "elsewhere"]);
    expect([...selectedAmong(sel, ["a", "b"])]).toEqual(["a"]);
    expect([...pruneSelection(sel, (id) => id !== "a")]).toEqual(["elsewhere"]);
    // Nothing dropped: the same set back (no needless re-render).
    expect(pruneSelection(sel, () => true)).toBe(sel);
  });

  it("puts up to eight units in a ring, starting at the top, and more in a list", () => {
    const four = radialSlots(4, 10)!;
    expect(four).toEqual([
      { x: 0, y: -10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
    ]);
    expect(radialSlots(RADIAL_MAX, 10)).toHaveLength(8);
    expect(radialSlots(RADIAL_MAX + 1, 10)).toBeNull();
    expect(radialSlots(1, 10)).toEqual([{ x: 0, y: -10 }]);
  });
});
