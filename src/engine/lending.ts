import { ACTIVE_STATUSES } from "./world/types";

// Lending units: a team lets another team move some of its units, and can
// take them back at any time. While lent, both teams can move the unit; the
// borrower sees it in full and sees through it (src/engine/world/visibility.ts),
// but can't give it any other order. No database code here; src/lib/lending.ts uses it.

export interface LendableUnit {
  ownerTeamId: string | null;
  status: string;
  lentToTeamId?: string | null;
}

/**
 * Why this team can't lend the unit to toTeamId (null = take it back), or null
 * if it can. contacts: the teams it has met (the same rule as trading).
 * frozen: the round is being resolved.
 */
export function lendProblem(unit: LendableUnit | undefined, teamId: string, toTeamId: string | null, contacts: readonly string[], frozen: boolean): string | null {
  if (!unit || unit.ownerTeamId !== teamId) return "That unit isn't yours.";
  if (frozen) return "Units can't be lent or taken back while the round is being resolved.";
  const now = unit.lentToTeamId ?? null;
  if (toTeamId === null) return now ? null : "That unit isn't lent to anyone.";
  if (toTeamId === teamId) return "You can't lend a unit to yourself.";
  if (now === toTeamId) return "That unit is already lent to them.";
  if (!contacts.includes(toTeamId)) return "You can only lend units to factions you've met.";
  if (!ACTIVE_STATUSES.has(unit.status)) return "Only units out on the map can be lent.";
  return null;
}

/** "Lent to Iron Clan" / "Lent to you by Iron Clan", for labels. */
export function lendLabel(unit: { ownerTeamId: string | null; lentToTeamId?: string | null }, viewerTeamId: string, teamName: (id: string) => string): string | null {
  if (!unit.lentToTeamId || !unit.ownerTeamId) return null;
  if (unit.ownerTeamId === viewerTeamId) return `Lent to ${teamName(unit.lentToTeamId)}`;
  if (unit.lentToTeamId === viewerTeamId) return `Lent to you by ${teamName(unit.ownerTeamId)}`;
  return null;
}
