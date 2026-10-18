import { RulesReference } from "@/components/play/RulesReference";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function RulesPage() {
  const viewer = await requireViewer();
  const { rules } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  const met = rules.creatures.filter((c) => !c.recruitable).map((c) => c.id);
  return <RulesReference rules={rules} metCreatureIds={met} />;
}
