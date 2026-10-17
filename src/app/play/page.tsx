import { Button, Card, Page } from "@/components/ui";
import { requireTeam } from "@/lib/session";
import { logout } from "../actions";

export default async function PlayHome() {
  const { team, player, game } = await requireTeam();
  return (
    <Page>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 rounded-full" style={{ background: team.colour }} aria-hidden />
          <h1 className="text-2xl font-semibold">{team.name}</h1>
        </div>
        <form action={logout}>
          <Button variant="secondary" type="submit">Leave</Button>
        </form>
      </div>
      <Card className="mt-6">
        <p>
          Welcome, <strong>{player.displayName}</strong>! You&apos;re playing in <strong>{game.name}</strong>.
        </p>
        <p className="mt-2 text-sm text-muted">The map, orders and results will appear here in later phases.</p>
      </Card>
    </Page>
  );
}
