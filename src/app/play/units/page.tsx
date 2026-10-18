import { Card } from "@/components/ui";
import { StatBlockView } from "@/components/StatBlockView";
import { RenameUnit } from "@/components/play/RenameUnit";
import { unitMaxHp } from "@/components/play/RegionDetails";
import { regionTitle } from "@/components/play/format";
import { unitEffects, unitUpkeep } from "@/engine/orders/economy";
import { milesPerRound } from "@/engine/orders/movement";
import { unitBonuses, unitTags } from "@/engine/ruleset/derive";
import { describeEffect, fmtRes, namesFrom } from "@/engine/ruleset/effects";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

const STATUS_ORDER = ["active", "hidden", "tamed", "captured", "stored", "dead", "disbanded"];
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  hidden: "Stealthed",
  tamed: "Tamed",
  captured: "Captured",
  stored: "Stored",
  dead: "Dead",
  disbanded: "Disbanded",
};

export default async function UnitsPage() {
  const viewer = await requireViewer();
  const { view, rules } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  const names = namesFrom(rules);
  const units = [...view.ownUnits].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const regionOf = (id: string | null) => {
    const r = view.regions.find((x) => x.id === id);
    return r ? regionTitle(r) : "off the map";
  };

  if (units.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">You don&apos;t have any units yet. Recruit some with the Recruit Unit order.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Click a name to rename a unit.</p>
      {units.map((u) => {
        const c = rules.creatures.find((x) => x.id === u.creatureId);
        const archetype = rules.archetypes.find((x) => x.id === u.archetypeId);
        const race = rules.races.find((x) => x.id === u.raceId);
        const max = unitMaxHp(rules, u);
        const per = milesPerRound(rules, u);
        const tags = c ? unitTags(rules, c, u.archetypeId) : [];
        const abilities = unitEffects(rules, u);
        const upkeep = unitUpkeep(rules, u);
        return (
          <Card key={u.id} className={u.status === "dead" || u.status === "disbanded" ? "opacity-60" : ""}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
              <RenameUnit unitId={u.id} name={u.name} placeholder={c?.statBlock.name ?? "Unit"} />
              <span className="text-sm text-muted">
                {[c?.statBlock.name ?? u.creatureId, archetype?.name, race?.name].filter(Boolean).join(" · ")}
                {u.isLeader ? " · Leader" : ""}
              </span>
              <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs">{STATUS_LABEL[u.status] ?? u.status}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted">HP</dt>
                <dd className={u.hp < max / 2 ? "text-danger" : ""}>
                  {u.hp} / {max}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Location</dt>
                <dd>{regionOf(u.regionId)}</dd>
              </div>
              <div>
                <dt className="text-muted">Movement this round</dt>
                <dd>
                  {Math.max(0, Math.round(per - u.milesUsed))} of {Math.round(per)} miles left
                </dd>
              </div>
              <div>
                <dt className="text-muted">Upkeep</dt>
                <dd>{u.isLeader ? "none (leader)" : fmtRes(upkeep, rules.resources)}</dd>
              </div>
            </dl>
            {tags.length > 0 && <p className="mt-2 text-xs text-muted">Tags: {tags.join(", ")}</p>}
            <div className="mt-2 text-sm">
              <span className="font-medium">Augments: </span>
              {u.augmentIds.length ? u.augmentIds.map((id) => rules.items.find((x) => x.id === id)?.name ?? id).join(", ") : <span className="text-muted">none</span>}
            </div>
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
                <summary className="cursor-pointer text-sm text-accent">Stat block</summary>
                <div className="mt-2">
                  <StatBlockView sb={c.statBlock} bonuses={unitBonuses(rules, u)} />
                </div>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
