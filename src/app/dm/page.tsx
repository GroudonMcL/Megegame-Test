import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button, Card, Page } from "@/components/ui";
import { requireDm } from "@/lib/session";
import { PRESETS } from "@/presets";
import { logout } from "../actions";
import { CreateGameForm } from "./DmForms";

export default async function DmHome() {
  await requireDm();
  const games = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      presetId: schema.games.presetId,
      teams: sql<number>`(select count(*)::int from ${schema.teams} where ${schema.teams.gameId} = ${schema.games.id})`,
    })
    .from(schema.games)
    .orderBy(desc(schema.games.createdAt));

  return (
    <Page>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">DM dashboard</h1>
        <form action={logout}>
          <Button variant="secondary" type="submit">Log out</Button>
        </form>
      </div>

      <Card className="mt-6">
        <CreateGameForm presets={PRESETS.map(({ id, name, description }) => ({ id, name, description }))} />
      </Card>

      {games.length === 0 && <p className="mt-6 text-muted">No games yet. Create one above.</p>}
      <ul className="mt-6 space-y-3">
        {games.map((g) => (
          <li key={g.id}>
            <Link href={`/dm/games/${g.id}`} className="block rounded-xl border border-border bg-card p-4 hover:border-accent">
              <span className="text-lg font-medium">{g.name}</span>
              <span className="ml-3 text-sm text-muted">
                {g.teams} team{g.teams === 1 ? "" : "s"} · {PRESETS.find((p) => p.id === g.presetId)?.name ?? g.presetId}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
