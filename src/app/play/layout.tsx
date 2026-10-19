import { PlayerShell } from "@/components/play/PlayerShell";
import { teamThemeProps } from "@/components/theme/teamTheme";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

// Every player screen sits on the team's fogged map. The map, toolbar and dock
// live here; each page (orders, units…) opens as a window over them.

export default async function PlayLayout({ children }: LayoutProps<"/play">) {
  const viewer = await requireViewer();
  const { view, rules, mapImage, round, orderState, orders } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  return (
    // data-team: accents inside use the team colour (globals.css).
    <div {...teamThemeProps(viewer.team.colour)}>
      <PlayerShell
        info={{
          team: { id: viewer.team.id, name: viewer.team.name, colour: viewer.team.colour, emblem: viewer.team.emblem },
          gameName: viewer.game.name,
          displayName: viewer.displayName,
          isDm: viewer.isDm,
          round: round ? { number: round.number, status: round.status, deadline: round.deadline?.toISOString() ?? null } : null,
          orders: orderState?.submittedAt ? "submitted" : orders.length ? "draft" : "none",
          resources: rules.resources.map((r) => ({ id: r.id, name: r.name, icon: r.icon, amount: view.team.resources[r.id] ?? 0 })),
        }}
        view={view}
        rules={rules}
        mapImage={mapImage}
      >
        {children}
      </PlayerShell>
    </div>
  );
}
