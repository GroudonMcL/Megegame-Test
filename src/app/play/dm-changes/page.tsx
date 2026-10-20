import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { DmChangeList } from "@/components/dm/DmChangeList";
import { loadDmChanges } from "@/lib/dmEdits";
import { requireViewer } from "@/lib/viewer";

// Only for the DM editing as a team: every change the DM made for this team,
// newest first, each with Undo.

export default async function DmChangesPage() {
  const viewer = await requireViewer();
  if (!viewer.isDm) redirect("/play");
  const changes = await loadDmChanges(viewer.gameId, viewer.teamId);
  return (
    <Card>
      <h2 className="text-lg font-medium">Your changes to {viewer.team.name}</h2>
      <p className="mt-1 text-sm text-muted">
        Orders, unit names, trades, items and recipes you changed while editing as this team. Undo puts back what was there before, unless something else has
        changed it since. Only you see this list.
      </p>
      <DmChangeList changes={changes} />
    </Card>
  );
}
