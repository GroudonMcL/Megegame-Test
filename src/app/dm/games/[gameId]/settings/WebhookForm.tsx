"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { saveWebhooksAction, testWebhooksAction } from "./actions";

const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs";

export function WebhookForm({ gameId, game, teams }: { gameId: string; game: string; teams: { id: string; name: string; url: string }[] }) {
  const [saved, save, saving] = useActionState(saveWebhooksAction, null);
  const [tested, test, testing] = useActionState(testWebhooksAction, null);
  return (
    <div className="mt-3 space-y-3">
      <form action={save} className="space-y-2">
        <input type="hidden" name="gameId" value={gameId} />
        <label className="block text-sm">
          Game channel
          <input name="game" className={field} defaultValue={game} placeholder="https://discord.com/api/webhooks/…" autoComplete="off" />
        </label>
        {teams.map((t) => (
          <label key={t.id} className="block text-sm">
            {t.name}
            <input name={`team-${t.id}`} className={field} defaultValue={t.url} placeholder="https://discord.com/api/webhooks/…" autoComplete="off" />
          </label>
        ))}
        <Button type="submit" disabled={saving}>
          Save webhooks
        </Button>
        {saved && (
          <span role="status" className={`ml-2 text-sm ${saved.ok ? "text-ok" : "text-danger"}`}>
            {saved.message}
          </span>
        )}
      </form>
      <form action={test}>
        <input type="hidden" name="gameId" value={gameId} />
        <Button type="submit" variant="secondary" disabled={testing}>
          Send a test message
        </Button>
        {tested && (
          <span role="status" className={`ml-2 text-sm ${tested.ok ? "text-ok" : "text-danger"}`}>
            {tested.message}
          </span>
        )}
      </form>
    </div>
  );
}
