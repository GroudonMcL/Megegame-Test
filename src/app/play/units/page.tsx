import { Card } from "@/components/ui";
import { ShowOnMap } from "@/components/play/mapSelection";
import { regionTitle } from "@/components/play/format";
import { UnitDetails } from "@/components/play/UnitDetails";
import { ON_MAP_STATUSES } from "@/engine/world/types";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

const STATUS_ORDER = ["active", "hidden", "tamed", "captured", "stored", "dead", "disbanded"];

export default async function UnitsPage() {
  const viewer = await requireViewer();
  const { view, rules } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
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
      {units.map((u) => (
        <Card key={u.id} className={u.status === "dead" || u.status === "disbanded" ? "opacity-60" : ""}>
          <UnitDetails unit={u} rules={rules} regionLabel={regionOf(u.regionId)} />
          {u.regionId && ON_MAP_STATUSES.has(u.status) && <ShowOnMap selection={{ kind: "unit", id: u.id }} className="mt-3" />}
        </Card>
      ))}
    </div>
  );
}
