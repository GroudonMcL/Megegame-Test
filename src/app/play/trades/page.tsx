import { Card } from "@/components/ui";
import { TradeForm, TradeList } from "@/components/play/Trades";
import { contactsOf } from "@/lib/contacts";
import { loadTeamView } from "@/lib/teamView";
import { loadTeamTrades } from "@/lib/trades";
import { requireViewer } from "@/lib/viewer";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { ACTIVE_STATUSES } from "@/engine/world/types";
import { regionTitle } from "@/components/play/format";
import { unitLabel } from "@/components/play/RegionDetails";

export default async function TradesPage() {
  const viewer = await requireViewer();
  const [{ view, rules }, trades, contactIds] = await Promise.all([
    loadTeamView(viewer.gameId, viewer.teamId, { record: false }),
    loadTeamTrades(viewer.gameId, viewer.teamId),
    contactsOf(viewer.gameId, viewer.teamId),
  ]);
  const contacts = contactIds.length
    ? await db.select({ id: schema.teams.id, name: schema.teams.name, colour: schema.teams.colour }).from(schema.teams).where(inArray(schema.teams.id, contactIds))
    : [];
  const name = (id: string) => rules.items.find((x) => x.id === id)?.name ?? id;
  const holdings = {
    resources: rules.resources.filter((r) => r.kind === "stockpile").map((r) => ({ id: r.id, name: r.name, icon: r.icon, have: view.team.resources[r.id] ?? 0 })),
    items: Object.entries(view.inventory)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ id, name: name(id), have: q })),
    recipes: rules.recipes.map((r) => ({ id: r.id, name: r.outputs.map((o) => name(o.itemId)).join(" + ") })),
    races: view.team.raceIds.filter((id) => id !== view.team.baseRaceId).map((id) => ({ id, name: rules.races.find((x) => x.id === id)?.name ?? id })),
    units: view.ownUnits.filter((u) => ACTIVE_STATUSES.has(u.status)).map((u) => ({ id: u.id, name: unitLabel(rules, u) })),
    regions: view.regions.filter((r) => r.ownerTeamId === view.team.id).map((r) => ({ id: r.id, name: regionTitle(r) })),
  };
  const catalogue = rules.items.map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name));
  const pending = trades.filter((t) => t.status === "proposed" || t.status === "accepted");
  const past = trades.filter((t) => !pending.includes(t));

  return (
    <div className="grid gap-4 @3xl:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <h2 className="text-lg font-medium">Open trades</h2>
        <p className="mt-1 text-sm text-muted">Accepted trades happen at the end of the round, if both sides still have what they offered.</p>
        <TradeList trades={pending} />
        {past.length > 0 && (
          <>
            <h3 className="mt-5 font-medium">Past trades</h3>
            <TradeList trades={past} />
          </>
        )}
      </Card>
      <Card>
        <h2 className="text-lg font-medium">Propose a trade</h2>
        {contacts.length === 0 ? (
          <p className="mt-2 text-sm text-muted">You haven&apos;t met another faction yet. You meet one when your units and theirs are in the same region, or when the DM introduces you.</p>
        ) : (
          <TradeForm contacts={contacts} holdings={holdings} catalogue={catalogue} />
        )}
      </Card>
    </div>
  );
}
