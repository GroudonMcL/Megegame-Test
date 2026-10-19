import { deriveStats, unitBonuses } from "@/engine/ruleset/derive";
import { describeEffect, fmtRes, namesFrom } from "@/engine/ruleset/effects";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView, ViewRegion } from "@/engine/world/teamView";
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

/** What the team knows about a region. showTitle = false when the panel around it already names the region. */
export function RegionDetails({ region, view, rules, showTitle = true }: { region: ViewRegion; view: TeamView; rules: Ruleset; showTitle?: boolean }) {
  const names = namesFrom(rules);
  const tier = rules.settlementTiers.find((t) => t.id === region.settlementTierId);
  const own = view.ownUnits.filter((u) => u.regionId === region.id && ON_MAP_STATUSES.has(u.status));
  const others = view.otherUnits.filter((u) => u.regionId === region.id);

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
            {own.map((u) => (
              <li key={u.id}>
                <TeamEmblem team={view.team} size={14} className="mr-1 align-[-2px]" />
                {unitLabel(rules, u)} · {u.status === "dead" ? "dead" : `${u.hp}/${unitMaxHp(rules, u)} HP`}
                {u.status === "hidden" ? " · stealthed" : ""}
              </li>
            ))}
            {others.map((u) => (
              <li key={u.id}>
                <TeamEmblem team={(u.ownerTeamId && view.teams.find((t) => t.id === u.ownerTeamId)) || null} size={14} className="mr-1 align-[-2px]" />
                {u.creatureName} · {u.ownerTeamId ? ownerName(view, u.ownerTeamId) : "wild"}
                {u.dead ? " · dead" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
