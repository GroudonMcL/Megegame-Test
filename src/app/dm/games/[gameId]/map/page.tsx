import { MapEditor } from "@/components/map/MapEditor";
import type { ConnectionData, RegionData, TerrainAreaData } from "@/components/map/mapData";
import { loadConversionReport, loadMapState } from "@/lib/map";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";

export default async function MapEditorPage({ params }: PageProps<"/dm/games/[gameId]/map">) {
  await requireDm();
  const { gameId } = await params;
  const [state, { ruleset }, conversionReport] = await Promise.all([loadMapState(gameId), loadRuleset(gameId), loadConversionReport(gameId)]);
  return (
    <MapEditor
      gameId={gameId}
      ruleset={ruleset}
      regions={state.regions as RegionData[]}
      connections={state.connections as ConnectionData[]}
      terrainAreas={state.terrainAreas as TerrainAreaData[]}
      teams={state.teams}
      mapImage={state.mapImage}
      milesAcross={state.milesAcross}
      conversionReport={conversionReport}
    />
  );
}
