// Team emblems: simple filled shapes on a 24×24 grid, chosen so each one is
// recognisable by its outline alone at small sizes. A team shows its emblem
// next to its colour everywhere, so players never have to rely on colour.
//
// This is plain data (no React) so the server can validate emblem IDs and the
// map can draw them inside SVG. Unit icons can be added as another set in the
// same shape later.

export interface Glyph {
  id: string;
  label: string;
  /** SVG path data in a 0 0 24 24 box. */
  d: string;
  /** Use even-odd filling (for shapes with holes). */
  evenOdd?: boolean;
}

function star(points: number, outer: number, inner: number, rotate = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotate + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
}

export const EMBLEMS: Glyph[] = [
  { id: "shield", label: "Shield", d: "M12 2 L20 5 V11 C20 16.5 16.5 20.5 12 22 C7.5 20.5 4 16.5 4 11 V5 Z" },
  { id: "crown", label: "Crown", d: "M3 7 L7.5 11 L12 4 L16.5 11 L21 7 L19 17 H5 Z M5 18.5 H19 V21 H5 Z" },
  { id: "tower", label: "Tower", d: "M5 3 H8 V5 H10.5 V3 H13.5 V5 H16 V3 H19 V9 L17 11 V21 H7 V11 L5 9 Z" },
  { id: "star", label: "Star", d: star(5, 10, 4.2) },
  { id: "sun", label: "Sun", d: star(8, 10.5, 6) },
  { id: "moon", label: "Moon", d: "M14 2.5 A9.5 9.5 0 1 0 21.5 16 A7.5 7.5 0 0 1 14 2.5 Z" },
  { id: "flame", label: "Flame", d: "M12 2 C13 6 18 8.5 18 14.5 A6 6 0 0 1 6 14.5 C6 11 8 9.5 9 7 C10 9 10.5 10 11.5 10.5 C12.5 8 12.5 5 12 2 Z" },
  { id: "drop", label: "Drop", d: "M12 2 C12 2 5 10 5 15 A7 7 0 0 0 19 15 C19 10 12 2 12 2 Z" },
  { id: "leaf", label: "Leaf", d: "M20 3 C10 3 4 8 4 15 C4 17.5 5 20 6.5 21 C14 21 20 13 20 3 Z" },
  { id: "mountain", label: "Mountain", d: "M1.5 20 L9 6 L13 13 L15.5 9.5 L22.5 20 Z" },
  { id: "tree", label: "Tree", d: "M12 2 L19 11.5 H15 L20 18 H13.5 V22 H10.5 V18 H4 L9 11.5 H5 Z" },
  { id: "sword", label: "Sword", d: "M12 1 L14 4 V14 H18 V16.5 H14 V19 H15.5 V22.5 H8.5 V19 H10 V16.5 H6 V14 H10 V4 Z" },
  { id: "eye", label: "Eye", d: "M1 12 C5 4.5 19 4.5 23 12 C19 19.5 5 19.5 1 12 Z M12 8 A4 4 0 1 0 12.001 8 Z", evenOdd: true },
  { id: "diamond", label: "Diamond", d: "M12 1.5 L21.5 12 L12 22.5 L2.5 12 Z" },
  { id: "hexagon", label: "Hexagon", d: "M12 2 L20.7 7 V17 L12 22 L3.3 17 V7 Z" },
  { id: "heart", label: "Heart", d: "M12 21 C5 15.5 2 12 2 8 A5 5 0 0 1 12 6 A5 5 0 0 1 22 8 C22 12 19 15.5 12 21 Z" },
];

/** Wild monsters (no team): claw marks. Not offered to teams. */
export const WILD_EMBLEM: Glyph = {
  id: "wild",
  label: "Wild",
  d: "M5.5 3 H8.5 L6 21 H3 Z M12.5 3 H15.5 L13 21 H10 Z M19.5 3 H22.5 L20 21 H17 Z",
};

export const EMBLEM_IDS = EMBLEMS.map((e) => e.id);

/**
 * A team's emblem. Teams that haven't picked one get a stable one from their
 * ID, so every team always shows some emblem.
 */
export function emblemFor(team: { id: string; emblem?: string | null }): Glyph {
  const chosen = team.emblem && EMBLEMS.find((e) => e.id === team.emblem);
  if (chosen) return chosen;
  let h = 0;
  for (const ch of team.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EMBLEMS[h % EMBLEMS.length];
}

/** The emblem for a new team: the first one no team uses yet. */
export function nextTeamEmblem(used: string[]): string {
  return EMBLEMS.find((e) => !used.includes(e.id))?.id ?? EMBLEMS[used.length % EMBLEMS.length].id;
}
