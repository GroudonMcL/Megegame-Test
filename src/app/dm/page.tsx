import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button, Card, Page } from "@/components/ui";
import { requireDm } from "@/lib/session";
import { logout } from "../actions";
import { regenerateJoinCode } from "./actions";
import { CreateGameForm, CreateTeamForm } from "./DmForms";

export default async function DmHome() {
  await requireDm();
  const [games, teams, players] = await Promise.all([
    db.select().from(schema.games).orderBy(desc(schema.games.createdAt)),
    db.select().from(schema.teams).orderBy(asc(schema.teams.createdAt)),
    db.select().from(schema.players).orderBy(asc(schema.players.joinedAt)),
  ]);

  return (
    <Page>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">DM dashboard</h1>
        <form action={logout}>
          <Button variant="secondary" type="submit">Log out</Button>
        </form>
      </div>

      <Card className="mt-6">
        <CreateGameForm />
      </Card>

      {games.length === 0 && <p className="mt-6 text-muted">No games yet. Create one above.</p>}

      {games.map((game) => {
        const gameTeams = teams.filter((t) => t.gameId === game.id);
        return (
          <Card key={game.id} className="mt-6">
            <h2 className="text-lg font-medium">{game.name}</h2>
            <ul className="mt-4 space-y-3">
              {gameTeams.map((team) => {
                const teamPlayers = players.filter((p) => p.teamId === team.id);
                return (
                  <li key={team.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="h-4 w-4 rounded-full" style={{ background: team.colour }} aria-hidden />
                      <span className="font-medium">{team.name}</span>
                      <code className="rounded bg-background px-2 py-1 font-mono text-sm select-all">{team.joinCode}</code>
                      <form action={regenerateJoinCode} className="ml-auto">
                        <input type="hidden" name="teamId" value={team.id} />
                        <Button variant="secondary" type="submit" title="Makes a new code and signs out everyone on this team">
                          New code
                        </Button>
                      </form>
                    </div>
                    <p className="mt-2 text-sm text-muted">
                      {teamPlayers.length === 0
                        ? "Nobody has joined yet."
                        : `Joined: ${teamPlayers.map((p) => p.displayName).join(", ")}`}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4">
              <CreateTeamForm gameId={game.id} />
            </div>
          </Card>
        );
      })}
    </Page>
  );
}
