import Link from "next/link";
import { Card } from "@/components/ui";
import { Countdown } from "@/components/play/Countdown";
import { EconomyTable } from "@/components/play/EconomyTable";
import { RoundResults } from "@/components/play/RoundResults";
import { loadTeamResults } from "@/lib/results";
import { validateOrders } from "@/engine/orders/validate";
import { ACTIVE_STATUSES } from "@/engine/world/types";
import { loadTeamView, ordersOpen } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function Overview() {
  const viewer = await requireViewer();
  const [{ view, rules, round, orderState, orders }, [last]] = await Promise.all([
    loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm }),
    loadTeamResults(viewer.gameId, viewer.teamId, { limit: 1 }),
  ]);
  const check = validateOrders(rules, view, orders);
  const open = ordersOpen(round);
  const units = view.ownUnits.filter((u) => ACTIVE_STATUSES.has(u.status));
  const owned = view.regions.filter((r) => r.ownerTeamId === view.team.id);

  return (
    <div className="grid gap-4 @3xl:grid-cols-[1fr_22rem] [&>*]:min-w-0">
      <div className="space-y-4">
        <Card>
          <h2 className="text-lg font-medium">Resources</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {rules.resources.map((r) => {
              const now = view.team.resources[r.id] ?? 0;
              const end = check.economy.end[r.id] ?? 0;
              return (
                <div key={r.id} className="min-w-28 rounded-lg border border-border px-3 py-2">
                  <div className="text-sm text-muted">
                    {r.icon} {r.name}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">{now}</div>
                  <div className={`text-xs ${end < 0 ? "text-danger" : "text-muted"}`}>
                    → {Math.round(end * 100) / 100} at end of round
                  </div>
                </div>
              );
            })}
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-link">Full breakdown</summary>
            <div className="mt-2">
              <EconomyTable economy={check.economy} resources={rules.resources} />
            </div>
          </details>
          <p className="mt-2 text-xs text-muted">Projected from your orders, income and upkeep. Buildings and units your orders add count from this round.</p>
        </Card>

        <Card>
          <h2 className="text-lg font-medium">{last ? `Round ${last.number} results` : "Last round's results"}</h2>
          {last ? (
            <div className="mt-3">
              <RoundResults result={last} rules={rules} />
              <Link href="/play/results" className="mt-2 inline-block text-sm text-link underline">
                All results →
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Results appear here once the DM publishes a round.</p>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <h2 className="text-lg font-medium">{round ? `Round ${round.number}` : "Waiting to start"}</h2>
          {round ? (
            <ul className="mt-2 space-y-1 text-sm">
              <li>
                Status: <strong>{round.status}</strong>
              </li>
              {round.deadline && (
                <li>
                  Deadline: <Countdown deadline={round.deadline.toISOString()} />
                </li>
              )}
              <li>
                Your orders:{" "}
                {orderState?.submittedAt ? (
                  <span className="text-ok">submitted by {orderState.submittedBy}</span>
                ) : orders.length ? (
                  <span className="text-danger">draft, not submitted</span>
                ) : (
                  <span className="text-muted">none yet</span>
                )}
              </li>
              <li className="text-muted">
                {check.slotsUsed}/{check.slotsTotal} numbered actions planned
                {check.ok ? "" : " · some orders have problems"}
              </li>
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">The DM hasn&apos;t opened the first round yet. You can look around in the meantime.</p>
          )}
          <Link href="/play/orders" className="mt-3 inline-block text-link underline">
            {open.open ? "Plan your orders →" : "See your orders →"}
          </Link>
        </Card>

        <Card>
          <h2 className="text-lg font-medium">Your faction</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <Link href="/play/units" className="underline">
                {units.length} unit{units.length === 1 ? "" : "s"}
              </Link>
            </li>
            <li>
              <Link href="/play/regions" className="underline">
                {owned.length} region{owned.length === 1 ? "" : "s"}
              </Link>
            </li>
          </ul>
          {view.team.secretObjectives && (
            <div className="mt-3">
              <h3 className="text-sm font-medium">Secret objectives</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm">{view.team.secretObjectives}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
