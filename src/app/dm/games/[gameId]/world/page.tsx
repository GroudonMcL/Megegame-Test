import { WorldMap } from "@/components/map/WorldMap";
import type { ConnectionData, RegionData, UnitData } from "@/components/map/mapData";
import { loadMapState } from "@/lib/map";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";

export default async function WorldPage({ params }: PageProps<"/dm/games/[gameId]/world">) {
  await requireDm();
  const { gameId } = await params;
  const [state, { ruleset }] = await Promise.all([loadMapState(gameId), loadRuleset(gameId)]);
  return (
    <WorldMap
      gameId={gameId}
      ruleset={ruleset}
      regions={state.regions as RegionData[]}
      connections={state.connections as ConnectionData[]}
      units={state.units as UnitData[]}
      teams={state.teams}
      mapImage={state.mapImage}
    />
  );
}
