import { MapEditor } from "@/components/map/MapEditor";
import type { ConnectionData, RegionData } from "@/components/map/mapData";
import { loadMapState } from "@/lib/map";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";

export default async function MapEditorPage({ params }: PageProps<"/dm/games/[gameId]/map">) {
  await requireDm();
  const { gameId } = await params;
  const [state, { ruleset }] = await Promise.all([loadMapState(gameId), loadRuleset(gameId)]);
  return (
    <MapEditor
      gameId={gameId}
      ruleset={ruleset}
      regions={state.regions as RegionData[]}
      connections={state.connections as ConnectionData[]}
      teams={state.teams}
      mapImage={state.mapImage}
    />
  );
}
