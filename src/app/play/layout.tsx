import { PlayerShell } from "@/components/play/PlayerShell";
import { teamThemeProps } from "@/components/theme/teamTheme";
import { threadUnread } from "@/lib/messages";
import { loadTeamView, ordersOpen } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

// Every player screen sits on the team's fogged map. The map, toolbar and dock
// live here; each page (orders, units…) opens as a window over them.

export default async function PlayLayout({ children }: LayoutProps<"/play">) {
  const viewer = await requireViewer();
  const [{ view, rules, mapImage, map3d, round, orderState, orders }, unreadMessages] = await Promise.all([
    loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm }),
    threadUnread(viewer.team, viewer.isDm ? "dm" : "team"),
  ]);
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
          // The DM viewing as a team can edit its orders even when they're closed.
          ordersOpen: viewer.isDm ? { open: true, reason: "" } : ordersOpen(round),
          resources: rules.resources.map((r) => ({ id: r.id, name: r.name, icon: r.icon, amount: view.team.resources[r.id] ?? 0 })),
          unreadMessages,
        }}
        view={view}
        rules={rules}
        mapImage={mapImage}
        map3d={map3d}
        orders={{
          roundKey: round?.id ?? "none",
          orders,
          version: orderState?.version ?? 0,
          submitted: orderState?.submittedAt ? { at: orderState.submittedAt.toISOString(), by: orderState.submittedBy ?? "" } : null,
          open: ordersOpen(round),
          isDm: viewer.isDm,
          roundNumber: round?.number ?? null,
        }}
      >
        {children}
      </PlayerShell>
    </div>
  );
}
