// Plain helpers shared by the player screens (server and client).

export const WILD_COLOUR = "var(--wild)";

export function regionTitle(r: { code: string; name: string; state: string }) {
  if (r.state === "frontier") return `${r.code} (unexplored)`;
  return r.name ? `${r.code} ${r.name}` : r.code;
}
