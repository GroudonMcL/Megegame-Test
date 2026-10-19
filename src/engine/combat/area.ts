import type { Area } from "../ruleset/statblock";

// Area effects against units. Each unit takes up a square whose width depends
// on its creature size (a Medium unit is 30 ft wide). The area's width is
// compared with the units it covers, one after another:
//
//   first unit: normal damage + (width ÷ its footprint), at most +100%
//   then each further unit the leftover width fully covers: normal damage
//   a leftover part of a unit: that share of normal damage
//
// Lines are only a few feet wide, so they hit units one after another along
// their length, each for normal damage, with no bonus.

/** The widest measurement of an area, in feet. */
export function areaWidth(area: Area): number {
  switch (area.shape) {
    case "sphere":
    case "cylinder":
    case "emanation":
      return area.size * 2;
    case "cube":
    case "cone":
    case "line":
      return area.size;
  }
}

/**
 * Damage multipliers for the units an area covers, in the order given.
 * `footprints` are the widths of the candidate targets, primary target first.
 * Units it doesn't reach are left out.
 */
export function areaMultipliers(area: Area, footprints: number[]): number[] {
  if (!footprints.length) return [];
  const width = areaWidth(area);
  const out: number[] = [];
  let left: number;
  if (area.shape === "line") {
    out.push(1);
    left = width - footprints[0];
  } else {
    out.push(1 + Math.min(width / footprints[0], 1));
    left = width - footprints[0];
  }
  for (const f of footprints.slice(1)) {
    if (left <= 0) break;
    out.push(left >= f ? 1 : left / f);
    left -= f;
  }
  return out.map((m) => Math.round(m * 100) / 100);
}
