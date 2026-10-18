import { Card } from "@/components/ui";
import { regionTitle } from "@/components/play/format";
import { addTo, buildingTier } from "@/engine/orders/economy";
import type { ResourceAmounts } from "@/engine/ruleset/common";
import { fmtRes } from "@/engine/ruleset/effects";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function RegionsPage() {
  const viewer = await requireViewer();
  const { view, rules } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  const owned = view.regions.filter((r) => r.ownerTeamId === view.team.id);
  const totals = { production: {} as ResourceAmounts, upkeep: {} as ResourceAmounts };

  const rows = owned.map((r) => {
    const tier = rules.settlementTiers.find((t) => t.id === r.settlementTierId);
    const production: ResourceAmounts = { ...(tier?.production ?? {}) };
    const upkeep: ResourceAmounts = { ...(tier?.upkeep ?? {}) };
    for (const b of r.buildings) {
      const bt = buildingTier(rules, b);
      if (!bt) continue;
      addTo(production, bt.tier.production);
      addTo(upkeep, bt.tier.upkeep);
    }
    for (const d of r.deposits) if (d.production) addTo(production, d.production);
    addTo(totals.production, production);
    addTo(totals.upkeep, upkeep);
    return { r, tier, production, upkeep };
  });

  if (owned.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">You don&apos;t own any regions yet. Build an outpost in an empty region where you have a unit.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-sm">
          {owned.length} region{owned.length === 1 ? "" : "s"} · production <strong>{fmtRes(totals.production, rules.resources)}</strong> · upkeep{" "}
          <strong>{fmtRes(totals.upkeep, rules.resources)}</strong> per round (units&apos; upkeep is on the Units page)
        </p>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ r, tier, production, upkeep }) => {
          const free = tier ? tier.buildingSlots - r.buildings.length : 0;
          return (
            <Card key={r.id}>
              <h2 className="font-medium">{regionTitle(r)}</h2>
              <p className="text-sm text-muted">
                {tier ? tier.name : "No settlement"}
                {tier ? ` · ${free} free building slot${free === 1 ? "" : "s"} of ${tier.buildingSlots}` : ""}
              </p>
              {r.buildings.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-sm">
                  {r.buildings.map((b, i) => {
                    const bt = buildingTier(rules, b);
                    return (
                      <li key={i}>
                        {bt?.def.name ?? b.buildingId}
                        {bt && bt.def.tiers.length > 1 ? ` ${b.tier}/${bt.def.tiers.length}` : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">No buildings.</p>
              )}
              <p className="mt-2 text-sm">
                <span className="text-ok">+ {fmtRes(production, rules.resources)}</span> · <span className="text-danger">− {fmtRes(upkeep, rules.resources)}</span>
              </p>
              {r.deposits.length > 0 && <p className="mt-1 text-xs text-muted">Deposits: {r.deposits.map((d) => d.name).join(", ")}</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
