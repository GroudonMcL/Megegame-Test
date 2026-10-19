// A fixed set of team colours that stay distinguishable from each other,
// including for colour-blind readers (validated categorical palette, in order).
export const TEAM_COLOURS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

/** The next colour for a new team: the first one no team uses yet. */
export function nextTeamColour(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  return TEAM_COLOURS.find((c) => !taken.has(c)) ?? TEAM_COLOURS[used.length % TEAM_COLOURS.length];
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Colours for charting teams side by side: their own colours if those are all
 * clearly different, otherwise the fixed palette in team order.
 */
export function chartColours(colours: string[]): string[] {
  const close = colours.some((a, i) => colours.some((b, j) => j > i && rgb(a).reduce((s, v, k) => s + (v - rgb(b)[k]) ** 2, 0) < 60 ** 2));
  return close ? colours.map((c, i) => TEAM_COLOURS[i] ?? c) : colours;
}
