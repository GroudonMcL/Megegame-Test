import { OrderBuilder, type OrderPrefill } from "@/components/play/OrderBuilder";
import { loadTeamView, ordersOpen } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function OrdersPage({ searchParams }: PageProps<"/play/orders">) {
  const viewer = await requireViewer();
  const [loaded, params] = await Promise.all([loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm }), searchParams]);
  const { orderState } = loaded;
  // ?add=<action>&unit=…|region=…|target=…&n=… comes from a quick action on the map.
  const add = one(params.add);
  const prefill: OrderPrefill | null = add
    ? { key: one(params.n) ?? add, id: crypto.randomUUID(), actionTypeId: add, unitId: one(params.unit), regionId: one(params.region), targetId: one(params.target) }
    : null;
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
      prefill={prefill}
    />
  );
}
