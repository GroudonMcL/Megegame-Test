"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { lockRoundAction, openRoundAction, reopenRoundAction, setDeadlineAction } from "./rounds";

/** A deadline picker in the DM's local time, sent to the server as an exact moment. */
function DeadlineInput({ initial }: { initial: string | null }) {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [local, setLocal] = useState(initial ? toLocal(initial) : "");
  return (
    <>
      <input suppressHydrationWarning type="datetime-local" aria-label="Deadline" className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" value={local} onChange={(e) => setLocal(e.target.value)} />
      <input suppressHydrationWarning type="hidden" name="deadline" value={local ? new Date(local).toISOString() : ""} />
    </>
  );
}

export function RoundControls({ gameId, round }: { gameId: string; round: { number: number; status: string; deadline: string | null } | null }) {
  if (!round || round.status === "published") {
    return (
      <form action={openRoundAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="gameId" value={gameId} />
        <span className="text-sm">Deadline (optional):</span>
        <DeadlineInput initial={null} />
        <Button type="submit">Open round {(round?.number ?? 0) + 1}</Button>
      </form>
    );
  }
  if (round.status === "resolving" || round.status === "review") {
    return (
      <p className="mt-3 text-sm">
        Being resolved.{" "}
        <a href={`/dm/games/${gameId}/resolve`} className="text-accent underline">
          Go to the resolution queue →
        </a>
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <form action={setDeadlineAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="gameId" value={gameId} />
        <span className="text-sm">Deadline:</span>
        <DeadlineInput initial={round.deadline} />
        <Button type="submit" variant="secondary">
          Set deadline
        </Button>
      </form>
      {round.status === "open" && (
        <form action={lockRoundAction}>
          <input type="hidden" name="gameId" value={gameId} />
          <Button type="submit" variant="secondary" title="Players can no longer change their orders">
            Lock orders now
          </Button>{" "}
          <a href={`/dm/games/${gameId}/resolve`} className="ml-2 text-sm text-accent underline">
            Resolve the round →
          </a>
        </form>
      )}
      {round.status === "locked" && (
        <form action={reopenRoundAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="gameId" value={gameId} />
          <Button type="submit" variant="secondary">
            Reopen orders
          </Button>
          <a href={`/dm/games/${gameId}/resolve`} className="text-sm text-accent underline">
            Resolve the round →
          </a>
        </form>
      )}
    </div>
  );
}
