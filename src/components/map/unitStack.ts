// The units standing at one spot on the map, as the radial menu (UnitRadial)
// shows them: which can be ticked, which a drag takes, which are greyed out,
// and where each sits around the badge. Plain functions, shared by the team
// map and the DM's World map.

/** Up to this many units sit in a ring around the badge; more become a list. */
export const RADIAL_MAX = 8;

export interface StackEntry {
  id: string;
  /** The unit's name, or for a unit the viewer only half-knows, its type. */
  name: string;
  /** A second line: its type, or "Knight · Iron Clan" for another side's unit. */
  detail: string;
  /** The owner's emblem; null = wild monster. */
  owner: { id: string; name: string; colour: string; emblem?: string | null } | null;
  /** The viewer can move it (and so tick it). */
  movable: boolean;
  dead?: boolean;
  /** E.g. "Lent to you by Iron Clan". */
  note?: string | null;
}

/** What a drag from the badge moves: the ticked units that can move, or every unit there that can. */
export function dragUnits(entries: StackEntry[], selected: ReadonlySet<string>): string[] {
  const movable = entries.filter((e) => e.movable).map((e) => e.id);
  const ticked = movable.filter((id) => selected.has(id));
  return ticked.length ? ticked : movable;
}

/** The selection with one unit ticked or unticked (units that can't move can't be ticked). */
export function toggleUnit(selected: ReadonlySet<string>, entry: StackEntry): Set<string> {
  const next = new Set(selected);
  if (next.has(entry.id)) next.delete(entry.id);
  else if (entry.movable) next.add(entry.id);
  return next;
}

/**
 * Greyed out in the menu and the side panel: units the viewer can't move, and
 * units left out when some others here are ticked.
 */
export function isGreyed(entry: Pick<StackEntry, "id" | "movable">, selectedHere: ReadonlySet<string>): boolean {
  return !entry.movable || (selectedHere.size > 0 && !selectedHere.has(entry.id));
}

/** The ticked units among these (the selection is kept per spot, by unit). */
export function selectedAmong(selected: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  return new Set([...ids].filter((id) => selected.has(id)));
}

/** The selection without units that have moved away or can't move any more. */
export function pruneSelection(selected: ReadonlySet<string>, keep: (id: string) => boolean): Set<string> {
  const next = new Set([...selected].filter(keep));
  return next.size === selected.size ? (selected as Set<string>) : next;
}

/**
 * Where each of n units sits around the badge (pixels from its centre), the
 * first at the top and going clockwise; null = too many for a ring (use a list).
 */
export function radialSlots(n: number, radius: number): { x: number; y: number }[] | null {
  if (n > RADIAL_MAX) return null;
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    return { x: Math.round(Math.cos(a) * radius * 10) / 10, y: Math.round(Math.sin(a) * radius * 10) / 10 };
  });
}
