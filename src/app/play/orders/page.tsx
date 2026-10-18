import { OrderBuilder } from "@/components/play/OrderBuilder";
import { loadTeamView, ordersOpen } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function OrdersPage() {
  const viewer = await requireViewer();
  const loaded = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  const { orderState } = loaded;
  return (
    <OrderBuilder
      key={loaded.round?.id ?? "none"}
      view={loaded.view}
      rules={loaded.rules}
      mapImage={loaded.mapImage}
      initialOrders={loaded.orders}
      version={orderState?.version ?? 0}
      submitted={orderState?.submittedAt ? { at: orderState.submittedAt.toISOString(), by: orderState.submittedBy ?? "" } : null}
      open={ordersOpen(loaded.round)}
      isDm={viewer.isDm}
      roundNumber={loaded.round?.number ?? null}
    />
  );
}
