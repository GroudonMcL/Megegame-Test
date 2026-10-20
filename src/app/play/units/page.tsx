import { Card } from "@/components/ui";
import { ShowOnMap } from "@/components/play/mapSelection";
import { regionTitle } from "@/components/play/format";
import { UnitDetails } from "@/components/play/UnitDetails";
import { unitLabel } from "@/components/play/RegionDetails";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import { ON_MAP_STATUSES } from "@/engine/world/types";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

const STATUS_ORDER = ["active", "hidden", "tamed", "captured", "stored", "dead", "disbanded"];

export default async function UnitsPage() {
  const viewer = await requireViewer();
  const { view, rules } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  const units = [...view.ownUnits].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const team = (id: string | null | undefined) => view.teams.find((t) => t.id === id) ?? null;
  const lentOut = view.ownUnits.filter((u) => u.lentToTeamId);
  const lentIn = view.lentUnits ?? [];
  const regionOf = (id: string | null) => {
    const r = view.regions.find((x) => x.id === id);
    return r ? regionTitle(r) : "off the map";
  };

  if (units.length === 0 && lentIn.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">You don&apos;t have any units yet. Recruit some with the Recruit Unit order.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {(lentOut.length > 0 || lentIn.length > 0) && (
        <Card>
          <h2 className="font-medium">Lent units</h2>
          <p className="mt-1 text-xs text-muted">A lent unit can be moved by both teams until its owner takes it back. Whoever has it lent sees what it sees.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {lentOut.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <TeamEmblem team={team(u.lentToTeamId)} size={16} />
                <span>
                  <strong>{unitLabel(rules, u)}</strong> · lent to {team(u.lentToTeamId)?.name ?? "another faction"} · {regionOf(u.regionId)}
                </span>
              </li>
            ))}
            {lentIn.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <TeamEmblem team={team(u.ownerTeamId)} size={16} />
                <span>
                  <strong>{unitLabel(rules, u)}</strong> · lent to you by {team(u.ownerTeamId)?.name ?? "another faction"} · {regionOf(u.regionId)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-sm text-muted">Click a name to rename a unit. Lend one to a faction you&apos;ve met to let them move it too.</p>
      {units.map((u) => (
        <Card key={u.id} className={u.status === "dead" || u.status === "disbanded" ? "opacity-60" : ""}>
          <UnitDetails unit={u} rules={rules} regionLabel={regionOf(u.regionId)} borrower={team(u.lentToTeamId)} />
          {u.regionId && ON_MAP_STATUSES.has(u.status) && <ShowOnMap selection={{ kind: "unit", id: u.id }} className="mt-3" />}
        </Card>
      ))}
      {lentIn.map((u) => (
        <Card key={u.id}>
          <UnitDetails unit={u} rules={rules} regionLabel={regionOf(u.regionId)} lentBy={team(u.ownerTeamId) ?? { id: u.ownerTeamId ?? "", name: "another faction", colour: "#888888" }} />
          {u.regionId && ON_MAP_STATUSES.has(u.status) && <ShowOnMap selection={{ kind: "unit", id: u.id }} className="mt-3" />}
        </Card>
      ))}
    </div>
  );
}
