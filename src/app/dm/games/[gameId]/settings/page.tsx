import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card } from "@/components/ui";
import { WebhookForm } from "./WebhookForm";

const TABLES = [
  { id: "teams", label: "Teams" },
  { id: "units", label: "Units" },
  { id: "regions", label: "Regions" },
  { id: "orders", label: "Orders and outcomes" },
  { id: "rolls", label: "Roll log" },
  { id: "resources", label: "Resources by round" },
];

export default async function SettingsPage({ params }: PageProps<"/dm/games/[gameId]/settings">) {
  const { gameId } = await params;
  const [[game], teams] = await Promise.all([
    db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1),
    db.select().from(schema.teams).where(eq(schema.teams.gameId, gameId)).orderBy(asc(schema.teams.createdAt)),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <h2 className="text-lg font-medium">Discord notifications</h2>
        <p className="mt-1 text-sm text-muted">
          In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. The game channel gets &quot;round opened&quot;, reminders and &quot;round published&quot;. Each team channel gets &quot;your results are ready&quot; with its resource changes. Keep these URLs secret: anyone with one can post in that channel.
        </p>
        <WebhookForm gameId={gameId} game={game.discordWebhookUrl} teams={teams.map((t) => ({ id: t.id, name: t.name, url: t.discordWebhookUrl }))} />
        <p className="mt-3 text-xs text-muted">
          A reminder also goes out automatically once a day (at 08:00 UTC) for a round whose deadline is less than 24 hours away. That needs the CRON_SECRET setting on Vercel; see docs/SETUP.md.
        </p>
      </Card>
      <Card>
        <h2 className="text-lg font-medium">Export</h2>
        <p className="mt-1 text-sm text-muted">A full backup of this game: rules, map, teams (with join codes), units, orders, rolls, trades, messages, history and the audit log. Keep it private.</p>
        <a href={`/api/dm/games/${gameId}/export`} className="mt-3 inline-block rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground" download>
          Download the whole game (JSON)
        </a>
        <h3 className="mt-5 font-medium">Spreadsheets (CSV)</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {TABLES.map((t) => (
            <li key={t.id}>
              <a href={`/api/dm/games/${gameId}/export/${t.id}`} className="text-link underline" download>
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
