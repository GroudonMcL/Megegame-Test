import { Card } from "@/components/ui";
import { RoundResults } from "@/components/play/RoundResults";
import { loadTeamResults } from "@/lib/results";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function ResultsPage() {
  const viewer = await requireViewer();
  const [{ rules }, results] = await Promise.all([loadTeamView(viewer.gameId, viewer.teamId, { record: false }), loadTeamResults(viewer.gameId, viewer.teamId)]);
  if (!results.length) {
    return (
      <Card>
        <p className="text-sm text-muted">No results yet. They appear here when the DM publishes a round.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {results.map((r) => (
        <Card key={r.number}>
          <h2 className="text-lg font-medium">Round {r.number}</h2>
          <div className="mt-3">
            <RoundResults result={r} rules={rules} />
          </div>
        </Card>
      ))}
    </div>
  );
}
