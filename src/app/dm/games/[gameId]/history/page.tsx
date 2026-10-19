import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card } from "@/components/ui";
import { ResourceChart, type Series } from "@/components/dm/ResourceChart";
import { RoundResults } from "@/components/play/RoundResults";
import { chartColours } from "@/components/teamColours";
import { loadTeamResults } from "@/lib/results";
import { loadRuleset } from "@/lib/rulesets";

// Past rounds: resources over time per team (from each round's published
// snapshot), and any team's orders and outcomes for any round.

export default async function HistoryPage({ params, searchParams }: PageProps<"/dm/games/[gameId]/history">) {
  const { gameId } = await params;
  const sp = await searchParams;
  const [{ ruleset }, teams, rounds] = await Promise.all([
    loadRuleset(gameId),
    db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt)),
    db
      .select({ number: schema.rounds.number, snapshot: schema.rounds.snapshot, publishedAt: schema.rounds.publishedAt })
      .from(schema.rounds)
      .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.status, "published")))
      .orderBy(asc(schema.rounds.number)),
  ]);
  const players = teams.filter((t) => !t.isNpc);
  const colours = chartColours(players.map((t) => t.colour));
  const numbers = rounds.map((r) => r.number);
  const at = (snapshot: unknown, teamId: string, resourceId: string): number | null => {
    const t = (snapshot as { teams?: { id: string; resources: Record<string, number> }[] } | null)?.teams?.find((x) => x.id === teamId);
    return t ? Math.round((t.resources[resourceId] ?? 0) * 100) / 100 : null;
  };
  const charts = ruleset.resources.map((res) => ({
    id: res.id,
    title: `${res.icon} ${res.name}`.trim(),
    series: players.map((t, i): Series => ({ teamId: t.id, name: t.name, colour: colours[i], values: rounds.map((r) => at(r.snapshot, t.id, res.id)) })),
  }));

  const roundNo = Number(sp.round ?? numbers.at(-1) ?? 0);
  const teamId = typeof sp.team === "string" && teams.some((t) => t.id === sp.team) ? sp.team : players[0]?.id;
  const results = teamId && numbers.includes(roundNo) ? (await loadTeamResults(gameId, teamId)).find((r) => r.number === roundNo) : undefined;
  const link = (round: number, team?: string) => `/dm/games/${gameId}/history?round=${round}&team=${team ?? teamId ?? ""}`;

  if (!rounds.length) return <p className="text-sm text-muted">No rounds have been published yet.</p>;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-medium">Resources after each round</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {charts.map((c) => (
            <ResourceChart key={c.id} title={c.title} rounds={numbers} series={c.series} />
          ))}
        </div>
      </section>
      <Card>
        <h2 className="text-lg font-medium">Orders and outcomes</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {numbers.map((n) => (
            <Link key={n} href={link(n)} className={`rounded border px-2 py-0.5 ${n === roundNo ? "border-accent bg-accent/10" : "border-border"}`}>
              Round {n}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {teams.map((t) => (
            <Link key={t.id} href={link(roundNo, t.id)} className={`flex items-center gap-1 rounded border px-2 py-0.5 ${t.id === teamId ? "border-accent bg-accent/10" : "border-border"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.colour }} aria-hidden />
              {t.name}
            </Link>
          ))}
        </div>
        <div className="mt-4">{results ? <RoundResults result={results} rules={ruleset} /> : <p className="text-sm text-muted">Nothing for this team in round {roundNo}.</p>}</div>
        <p className="mt-3 text-xs text-muted">This is what the team saw on its Results page (rolls you hid aren&apos;t shown).</p>
      </Card>
    </div>
  );
}
