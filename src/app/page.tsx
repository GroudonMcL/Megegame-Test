import Link from "next/link";
import { Card, Page } from "@/components/ui";
import { checkHealth } from "@/lib/health";
import { getTeamSession } from "@/lib/session";
import { JoinForm } from "./JoinForm";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const [health, params] = await Promise.all([checkHealth(), searchParams]);
  const current = health.ok ? await getTeamSession().catch(() => null) : null;

  return (
    <Page>
      <h1 className="text-3xl font-semibold tracking-tight">Megagame</h1>
      <p className="mt-2 text-muted">Hello, world! Join your team with the code your DM gave you.</p>

      <div className="mt-8 grid gap-6">
        {current && (
          <Card>
            <p>
              You&apos;re signed in as <strong>{current.player.displayName}</strong> on{" "}
              <strong>{current.team.name}</strong>.
            </p>
            <Link href="/play" className="mt-3 inline-block text-accent underline">
              Continue to your team →
            </Link>
          </Card>
        )}

        <Card>
          <h2 className="mb-4 text-lg font-medium">Join a team</h2>
          {params.expired && (
            <p className="mb-4 text-sm text-muted">Your session ended (the DM may have changed your team&apos;s code). Please join again.</p>
          )}
          <JoinForm />
        </Card>

        <p className="text-sm text-muted">
          Running the game? <Link href="/dm/login" className="text-accent underline">DM login</Link>
        </p>
      </div>

      <footer className="mt-12 border-t border-border pt-4 text-xs text-muted">
        <p className="font-medium">Setup status</p>
        <ul className="mt-1 space-y-0.5">
          {health.checks.map((c) => (
            <li key={c.name}>
              <span className={c.ok ? "text-ok" : "text-danger"}>{c.ok ? "✓" : "✗"}</span> {c.name}: {c.detail}
            </li>
          ))}
        </ul>
      </footer>
    </Page>
  );
}
