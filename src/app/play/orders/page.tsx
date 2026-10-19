import { OrderBuilder } from "@/components/play/OrderBuilder";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

// The order list itself comes from the player shell (it's shared with the map).
export default async function OrdersPage() {
  const viewer = await requireViewer();
  const loaded = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  return <OrderBuilder view={loaded.view} rules={loaded.rules} mapImage={loaded.mapImage} />;
}
