import type { ReactNode } from "react";
import { TeamEmblem, type EmblemTeam } from "@/components/icons/TeamEmblem";
import { StatBlockView } from "@/components/StatBlockView";
import { unitEffects, unitUpkeep } from "@/engine/orders/economy";
import { milesPerRound } from "@/engine/orders/movement";
import { unitBonuses, unitTags } from "@/engine/ruleset/derive";
import { describeEffect, fmtRes, namesFrom } from "@/engine/ruleset/effects";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { WorldUnit } from "@/engine/world/types";
import { unitMaxHp } from "./RegionDetails";
import { itemsText } from "@/engine/equipment";
import { ABILITIES, signed } from "@/engine/ruleset/common";
import { EditUnit } from "./EditUnit";
import { LendUnit } from "./LendUnit";

// Everything about one of the team's own units: shown in the Units window and
// in the side panel when the unit is clicked on the map. Units another team
// has lent this team are shown in full too, saying whose they are. The Edit
// button (own units only) renames the unit and changes its equipment.

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  hidden: "Stealthed",
  tamed: "Tamed",
  captured: "Captured",
  stored: "Stored",
  dead: "Dead",
  disbanded: "Disbanded",
};

/**
 * regionLabel: the unit's location as text (or a button, in the side panel). compact: a narrow panel.
 * lentBy: the team that lent this unit to the viewer's team (it can only move it).
 * borrower: for the team's own unit, the team it's lent to.
 */
export function UnitDetails({
  unit: u,
  rules,
  regionLabel,
  compact = false,
  lentBy,
  borrower,
}: {
  unit: WorldUnit;
  rules: Ruleset;
  regionLabel: ReactNode;
  compact?: boolean;
  lentBy?: EmblemTeam | null;
  borrower?: EmblemTeam | null;
}) {
  const names = namesFrom(rules);
  const c = rules.creatures.find((x) => x.id === u.creatureId);
  const archetype = rules.archetypes.find((x) => x.id === u.archetypeId);
  const race = rules.races.find((x) => x.id === u.raceId);
  const max = unitMaxHp(rules, u);
  const per = milesPerRound(rules, u);
  const tags = c ? unitTags(rules, c, u.archetypeId) : [];
  const abilities = unitEffects(rules, u);
  const upkeep = unitUpkeep(rules, u);
  const itemName = (id: string) => rules.items.find((x) => x.id === id)?.name ?? id;
  // Each race, archetype, academy and item bonus, with what it changes.
  const bonuses = unitBonuses(rules, u)
    .map((b) => ({
      source: b.source,
      parts: [
        ...ABILITIES.filter((a) => b.abilities?.[a]).map((a) => `${a.toUpperCase()} ${signed(b.abilities![a]!)}`),
        ...(b.effects ?? []).map((e) => describeEffect(e, names)),
      ],
    }))
    .filter((b) => b.parts.length);
  return (
    <>
      {lentBy && (
        <p className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-raised px-2 py-1 text-sm">
          <TeamEmblem team={lentBy} size={16} />
          <span>
            Lent to you by <strong>{lentBy.name}</strong>: you can move it (so can they) and see what it sees.
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <span className="px-1 py-0.5 text-base font-medium">{u.name || c?.statBlock.name || "Unit"}</span>
        {!lentBy && <EditUnit unit={u} rules={rules} />}
        <span className="text-sm text-muted">
          {[c?.statBlock.name ?? u.creatureId, archetype?.name, race?.name].filter(Boolean).join(" · ")}
          {u.isLeader ? " · Leader" : ""}
        </span>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs">{STATUS_LABEL[u.status] ?? u.status}</span>
      </div>
      <dl className={`mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm ${compact ? "" : "@xl:grid-cols-4"}`}>
        <div>
          <dt className="text-muted">HP</dt>
          <dd className={u.hp < max / 2 ? "text-danger" : ""}>
            {u.hp} / {max}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Location</dt>
          <dd>{regionLabel}</dd>
        </div>
        <div>
          <dt className="text-muted">Movement this round</dt>
          <dd>
            {Math.max(0, Math.round(per - u.milesUsed))} of {Math.round(per)} miles left
          </dd>
        </div>
        <div>
          <dt className="text-muted">Upkeep</dt>
          <dd>{lentBy ? `paid by ${lentBy.name}` : u.isLeader ? "none (leader)" : fmtRes(upkeep, rules.resources)}</dd>
        </div>
      </dl>
      {!lentBy && (u.status === "active" || u.status === "hidden" || u.lentToTeamId) && (
        <LendUnit unitId={u.id} lentToTeamId={u.lentToTeamId ?? null} borrower={borrower} unitName={u.name || c?.statBlock.name || "a unit"} />
      )}
      {tags.length > 0 && <p className="mt-2 text-xs text-muted">Tags: {tags.join(", ")}</p>}
      <div className="mt-2 text-sm">
        <span className="font-medium">Equipped: </span>
        {u.equippedItemIds.length ? u.equippedItemIds.map(itemName).join(", ") : <span className="text-muted">nothing</span>}
      </div>
      {(u.carried ?? []).length > 0 && (
        <div className="mt-1 text-sm">
          <span className="font-medium">Carrying: </span>
          {itemsText(u.carried ?? [], itemName)}
        </div>
      )}
      {bonuses.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="font-medium">Where its bonuses come from</span>
          <ul className="mt-1 space-y-0.5">
            {bonuses.map((b, i) => (
              <li key={i}>
                <span className="text-muted">{b.source}:</span> {b.parts.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {abilities.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="font-medium">Abilities</span>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {abilities.map((e, i) => (
              <li key={i}>{describeEffect(e, names)}</li>
            ))}
          </ul>
        </div>
      )}
      {c && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-link">Stat block</summary>
          <div className="mt-2">
            <StatBlockView sb={c.statBlock} bonuses={unitBonuses(rules, u)} />
          </div>
        </details>
      )}
    </>
  );
}
