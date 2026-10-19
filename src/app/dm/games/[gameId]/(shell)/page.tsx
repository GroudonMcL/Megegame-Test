import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button, Card } from "@/components/ui";
import { emblemFor } from "@/components/icons/emblems";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import { fmtRes } from "@/engine/ruleset/effects";
import { findReferenceProblems } from "@/engine/ruleset/validate";
import { loadRuleset } from "@/lib/rulesets";
import { regenerateJoinCode } from "../../../actions";
import { CreateTeamForm } from "../../../DmForms";
import { nextTeamColour } from "@/components/teamColours";
import { RoundControls } from "../RoundControls";
import { TeamEditor } from "../TeamEditor";
import { viewAsTeamAction } from "../rounds";

export default async function GameOverview({ params }: PageProps<"/dm/games/[gameId]">) {
  const { gameId } = await params;
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt));
  const players = teams.length
    ? await db.select().from(schema.players).where(inArray(schema.players.teamId, teams.map((t) => t.id))).orderBy(asc(schema.players.joinedAt))
    : [];
  const { ruleset } = await loadRuleset(gameId);
  const problems = findReferenceProblems(ruleset);
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  const [round] = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.currentRound)))
    .limit(1);
  const [orderStates, orderCounts] = round
    ? await Promise.all([
        db.select().from(schema.teamRoundOrders).where(eq(schema.teamRoundOrders.roundId, round.id)),
        db.select({ teamId: schema.orders.teamId }).from(schema.orders).where(eq(schema.orders.roundId, round.id)),
      ])
    : [[], []];

  return (
    <div className="grid gap-6 @3xl:grid-cols-[1fr_20rem] [&>*]:min-w-0">
      <Card className="@3xl:col-span-2">
        <h2 className="text-lg font-medium">{round ? `Round ${round.number}: ${round.status}` : "No round yet"}</h2>
        {round && (
          <p className="text-sm text-muted">
            {orderStates.filter((s) => s.submittedAt).length} of {teams.filter((t) => !t.isNpc).length} teams have submitted
            {round.deadline ? ` · deadline ${round.deadline.toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK time)` : " · no deadline"}
          </p>
        )}
        {!round && <p className="text-sm text-muted">Open the first round when the map and teams are ready. Players can look around before then, but can&apos;t give orders.</p>}
        <RoundControls gameId={gameId} round={round ? { number: round.number, status: round.status, deadline: round.deadline?.toISOString() ?? null } : null} />
      </Card>
      <Card>
        <h2 className="text-lg font-medium">Teams</h2>
        <ul className="mt-4 space-y-3">
          {teams.map((team) => {
            const teamPlayers = players.filter((p) => p.teamId === team.id);
            return (
              <li key={team.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <TeamEmblem team={team} size={22} />
                  <span className="font-medium">{team.name}</span>
                  {team.isNpc && <span className="rounded border border-border px-1.5 text-xs">NPC</span>}
                  <code className="rounded bg-background px-2 py-1 font-mono text-sm select-all">{team.joinCode}</code>
                  <form action={regenerateJoinCode} className="ml-auto">
                    <input type="hidden" name="teamId" value={team.id} />
                    <Button variant="secondary" type="submit" title="Makes a new code and signs out everyone on this team">
                      New code
                    </Button>
                  </form>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {teamPlayers.length === 0 ? "Nobody has joined yet." : `Joined: ${teamPlayers.map((p) => p.displayName).join(", ")}`}
                </p>
                <p className="text-sm text-muted">Resources: {fmtRes(team.resources, ruleset.resources)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  {round && <OrderStatus state={orderStates.find((s) => s.teamId === team.id)} count={orderCounts.filter((o) => o.teamId === team.id).length} />}
                  <form action={viewAsTeamAction} className="ml-auto">
                    <input type="hidden" name="gameId" value={gameId} />
                    <input type="hidden" name="teamId" value={team.id} />
                    <Button variant="secondary" type="submit" title="See the player screens exactly as this team sees them, and edit its orders">
                      View as team
                    </Button>
                  </form>
                </div>
                <TeamEditor
                  gameId={gameId}
                  team={{
                    id: team.id,
                    name: team.name,
                    colour: team.colour,
                    emblem: emblemFor(team).id,
                    isNpc: team.isNpc,
                    baseRaceId: team.baseRaceId,
                    raceIds: team.raceIds,
                    resources: team.resources,
                    secretObjectives: team.secretObjectives,
                    notes: team.notes,
                  }}
                  races={ruleset.races.map((r) => ({ id: r.id, name: r.name }))}
                  resources={ruleset.resources.map((r) => ({ id: r.id, name: r.name, icon: r.icon }))}
                />
              </li>
            );
          })}
          {teams.length === 0 && <li className="text-sm text-muted">No teams yet.</li>}
        </ul>
        <div className="mt-4">
          <CreateTeamForm gameId={gameId} colour={nextTeamColour(teams.map((t) => t.colour))} />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Ruleset</h2>
        <p className="mt-1 text-sm">{ruleset.meta.name}</p>
        <ul className="mt-2 text-sm text-muted">
          <li>{ruleset.resources.length} resources, {ruleset.buildings.length} buildings</li>
          <li>{ruleset.creatures.filter((c) => c.recruitable).length} unit types, {ruleset.creatures.filter((c) => !c.recruitable).length} monsters</li>
          <li>{ruleset.actionTypes.length} actions, {ruleset.rollTables.length} roll tables</li>
        </ul>
        <p className={`mt-2 text-sm ${problems.length ? "text-danger" : "text-ok"}`}>
          {problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"} to fix` : "No problems ✓"}
        </p>
        <Link href={`/dm/games/${gameId}/ruleset`} className="mt-3 inline-block text-link underline">
          Edit the ruleset →
        </Link>
      </Card>
    </div>
  );
}

function OrderStatus({ state, count }: { state: typeof schema.teamRoundOrders.$inferSelect | undefined; count: number }) {
  if (state?.submittedAt) {
    return (
      <span className="text-ok">
        ✓ {count} orders submitted by {state.submittedBy} at {state.submittedAt.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}
      </span>
    );
  }
  if (count) return <span className="text-danger">Draft: {count} orders, not submitted</span>;
  return <span className="text-muted">No orders yet</span>;
}
