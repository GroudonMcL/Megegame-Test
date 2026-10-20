import { deriveStats, unitBonuses } from "@/engine/ruleset/derive";
import { describeEffect, fmtRes, namesFrom } from "@/engine/ruleset/effects";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { lendLabel } from "@/engine/lending";
import { movableUnits, type TeamView, type ViewRegion } from "@/engine/world/teamView";
import { ON_MAP_STATUSES, type WorldUnit } from "@/engine/world/types";
import { regionTitle } from "./format";
import { TeamEmblem } from "@/components/icons/TeamEmblem";

export function unitLabel(rules: Ruleset, u: WorldUnit) {
  const c = rules.creatures.find((x) => x.id === u.creatureId);
  const a = rules.archetypes.find((x) => x.id === u.archetypeId);
  const kind = [c?.statBlock.name ?? u.creatureId, a ? `(${a.name})` : ""].filter(Boolean).join(" ");
  return u.name ? `${u.name}: ${kind}` : kind;
}

export function unitMaxHp(rules: Ruleset, u: WorldUnit) {
  const c = rules.creatures.find((x) => x.id === u.creatureId);
  return c ? deriveStats(c.statBlock, unitBonuses(rules, u)).maxHp.total : u.hp;
}

export function ownerName(view: TeamView, id: string | null) {
  if (!id) return "nobody";
  if (id === view.team.id) return "you";
  return view.teams.find((t) => t.id === id)?.name ?? "another faction";
}

/**
 * What the team knows about a region. showTitle = false when the panel around
 * it already names the region; onUnitClick makes the units listed clickable;
 * greyed says which units to grey out (those the team can't move, or left out
 * of the units ticked to move on the map).
 */
export function RegionDetails({
  region,
  view,
  rules,
  showTitle = true,
  onUnitClick,
  greyed,
}: {
  region: ViewRegion;
  view: TeamView;
  rules: Ruleset;
  showTitle?: boolean;
  onUnitClick?: (kind: "unit" | "other", id: string) => void;
  greyed?: (unitId: string) => boolean;
}) {
  const unitButton = (kind: "unit" | "other", id: string, text: string) =>
    onUnitClick ? (
      <button type="button" className="text-left text-link underline-offset-2 hover:underline" onClick={() => onUnitClick(kind, id)}>
        {text}
      </button>
    ) : (
      text
    );
  const names = namesFrom(rules);
  const tier = rules.settlementTiers.find((t) => t.id === region.settlementTierId);
  // The team's own units and those lent to it.
  const own = movableUnits(view).filter((u) => u.regionId === region.id && ON_MAP_STATUSES.has(u.status));
  const teamOf = (id: string | null) => (id === view.team.id ? view.team : (id && view.teams.find((t) => t.id === id)) || null);
  const others = view.otherUnits.filter((u) => u.regionId === region.id);

  if (region.state === "glimpsed") {
    return (
      <div>
        {showTitle && <h3 className="font-medium">{regionTitle(region)}</h3>}
        <p className="mt-1 text-sm text-muted">
          This region is next to one you can see, so you can make out the land, but not who holds it or what&apos;s there. Send a unit there, or one that can see further.
        </p>
      </div>
    );
  }

  if (region.state === "frontier") {
    return (
      <div>
        {showTitle && <h3 className="font-medium">{regionTitle(region)}</h3>}
        <p className="mt-1 text-sm text-muted">You know there&apos;s a way into this region, but you haven&apos;t seen it yet. Send a unit there, or one that can see further.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        {showTitle && <h3 className="text-base font-medium">{regionTitle(region)}</h3>}
        {region.state === "remembered" && (
          <p className="text-xs text-muted">
            You can&apos;t see this region now. This is what you saw{region.lastSeenRound !== null ? ` in round ${region.lastSeenRound}` : ""}.
          </p>
        )}
        {region.description && <p className="mt-1 whitespace-pre-wrap">{region.description}</p>}
      </div>
      <ul className="space-y-0.5">
        <li>Owner: {ownerName(view, region.ownerTeamId)}</li>
        <li>Settlement: {tier ? `${tier.name} (${region.buildings.length}/${tier.buildingSlots} building slots)` : region.settleable === false ? "can't be settled" : "none"}</li>
      </ul>
      {region.buildings.length > 0 && (
        <div>
          <h4 className="font-medium">Buildings</h4>
          <ul className="list-inside list-disc">
            {region.buildings.map((b, i) => {
              const def = rules.buildings.find((x) => x.id === b.buildingId);
              return (
                <li key={i}>
                  {def?.name ?? b.buildingId}
                  {def && def.tiers.length > 1 ? ` (tier ${b.tier})` : ""}
                  {b.choice ? ` · ${b.choice.toUpperCase()}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {region.structures.length > 0 && (
        <div>
          <h4 className="font-medium">Ruins and dungeons</h4>
          <ul className="space-y-1">
            {region.structures.map((s, i) => (
              <li key={i}>
                <strong>{s.name || (s.kind === "ruin" ? "Ruin" : "Dungeon")}</strong> <span className="text-muted">({s.kind}{s.searched ? ", explored" : ""})</span>
                {s.description && <p className="text-muted">{s.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {region.deposits.length > 0 && (
        <div>
          <h4 className="font-medium">Deposits</h4>
          <ul className="list-inside list-disc">
            {region.deposits.map((d) => (
              <li key={d.id}>
                {d.name}
                {d.production ? ` (+${fmtRes(d.production, rules.resources)} per round)` : ""}
                {d.note ? <span className="text-muted"> · {d.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {region.features.length > 0 && (
        <div>
          <h4 className="font-medium">Features</h4>
          <ul className="list-inside list-disc">
            {region.features.map((f, i) => (
              <li key={i}>{describeEffect(f, names)}</li>
            ))}
          </ul>
        </div>
      )}
      {region.state === "visible" && (
        <div>
          <h4 className="font-medium">Units here</h4>
          {own.length + others.length === 0 && <p className="text-muted">None that you can see.</p>}
          <ul className="space-y-0.5">
            {own.map((u) => {
              const lent = lendLabel(u, view.team.id, (id) => teamOf(id)?.name ?? "another faction");
              return (
                <li key={u.id} className={greyed?.(u.id) ? "opacity-50" : undefined}>
                  <TeamEmblem team={teamOf(u.ownerTeamId)} size={14} className="mr-1 align-[-2px]" />
                  {unitButton("unit", u.id, unitLabel(rules, u))} · {u.status === "dead" ? "dead" : `${u.hp}/${unitMaxHp(rules, u)} HP`}
                  {u.status === "hidden" ? " · stealthed" : ""}
                  {lent ? ` · ${lent.charAt(0).toLowerCase()}${lent.slice(1)}` : ""}
                </li>
              );
            })}
            {others.map((u) => (
              <li key={u.id} className={greyed?.(u.id) ? "opacity-50" : undefined}>
                <TeamEmblem team={(u.ownerTeamId && view.teams.find((t) => t.id === u.ownerTeamId)) || null} size={14} className="mr-1 align-[-2px]" />
                {unitButton("other", u.id, u.creatureName)} · {u.ownerTeamId ? ownerName(view, u.ownerTeamId) : "wild"}
                {u.dead ? " · dead" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
