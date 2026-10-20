import "server-only";
import { db, schema } from "@/db";

type Tx = Pick<typeof db, "insert">;

/** Records a state change so it shows in history and can be undone later. */
export async function audit(
  tx: Tx,
  entry: { gameId: string; actor: string; kind: string; description: string; teamId?: string; before?: unknown; after?: unknown },
) {
  await tx.insert(schema.auditLog).values({
    gameId: entry.gameId,
    actor: entry.actor,
    kind: entry.kind,
    description: entry.description,
    teamId: entry.teamId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
