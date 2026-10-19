import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button, Card } from "@/components/ui";
import { allContacts } from "@/lib/contacts";
import { loadAllTrades } from "@/lib/trades";
import { dmCancelTradeAction, setContactAction } from "./actions";

const STATUS: Record<string, string> = {
  proposed: "waiting for an answer",
  accepted: "accepted (end of round)",
  declined: "declined",
  cancelled: "called off",
  executed: "done",
  failed: "failed",
};

export default async function DiplomacyPage({ params }: PageProps<"/dm/games/[gameId]/diplomacy">) {
  const { gameId } = await params;
  const [teams, contacts, trades] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt)),
    allContacts(gameId),
    loadAllTrades(gameId),
  ]);
  const met = (a: string, b: string) => contacts.find((c) => (c.teamA === a && c.teamB === b) || (c.teamA === b && c.teamB === a));

  return (
    <div className="grid gap-6 @3xl:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <h2 className="text-lg font-medium">Who has met</h2>
        <p className="mt-1 text-sm text-muted">
          Teams that have met can trade. They meet automatically when, at the end of a round, their units are in the same region and at least one side can see the other&apos;s. You can also mark it here.
        </p>
        {teams.length < 2 ? (
          <p className="mt-3 text-sm text-muted">Add at least two teams first.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th />
                  {teams.map((t) => (
                    <th key={t.id} className="px-1 pb-1 text-left align-bottom text-xs font-medium">
                      <span className="inline-block max-w-24 truncate" title={t.name}>
                        {t.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((a, i) => (
                  <tr key={a.id}>
                    <th className="pr-2 text-left text-xs font-medium whitespace-nowrap">{a.name}</th>
                    {teams.map((b, j) => {
                      if (j <= i) return <td key={b.id} />;
                      const c = met(a.id, b.id);
                      return (
                        <td key={b.id} className="p-0.5">
                          <form action={setContactAction}>
                            <input type="hidden" name="gameId" value={gameId} />
                            <input type="hidden" name="a" value={a.id} />
                            <input type="hidden" name="b" value={b.id} />
                            <input type="hidden" name="met" value={c ? "0" : "1"} />
                            <button
                              type="submit"
                              className={`h-8 w-full min-w-12 rounded border text-xs ${c ? "border-ok bg-ok/15 text-ok" : "border-border text-muted"}`}
                              title={c ? `Met in round ${c.since}. Click to remove.` : "Not met. Click to introduce them."}
                              aria-label={`${a.name} and ${b.name}: ${c ? "have met" : "have not met"}`}
                            >
                              {c ? `✓ r${c.since}` : "–"}
                            </button>
                          </form>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="text-lg font-medium">Trades</h2>
        {trades.length === 0 && <p className="mt-2 text-sm text-muted">No trades yet.</p>}
        <ul className="mt-3 space-y-3">
          {trades.map((t) => (
            <li key={t.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>
                  {t.from} → {t.to}
                </strong>
                <span className="text-xs text-muted">round {t.round}</span>
                <span className="ml-auto text-xs">{STATUS[t.status] ?? t.status}</span>
              </div>
              <p className="mt-1">
                <span className="text-muted">{t.from} gives:</span> {t.give}
              </p>
              <p>
                <span className="text-muted">{t.to} gives:</span> {t.get}
              </p>
              {t.message && <p className="mt-1 whitespace-pre-wrap italic">{t.message}</p>}
              {t.result && <p className="mt-1 text-xs text-muted">{t.result}</p>}
              {(t.status === "proposed" || t.status === "accepted") && (
                <form action={dmCancelTradeAction} className="mt-2">
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="tradeId" value={t.id} />
                  <Button type="submit" variant="secondary">
                    Call it off
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
