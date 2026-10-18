import { PlayerMapScreen } from "@/components/play/PlayerMapScreen";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function PlayerMap() {
  const viewer = await requireViewer();
  const { view, rules, mapImage } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  return <PlayerMapScreen view={view} rules={rules} mapImage={mapImage} />;
}
