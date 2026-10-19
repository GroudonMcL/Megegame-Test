import { NavLinks } from "@/components/NavLinks";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { teamThemeProps } from "@/components/theme/teamTheme";
import { Button } from "@/components/ui";
import { requireViewer } from "@/lib/viewer";
import { logout } from "../actions";
import { stopViewingAs } from "./actions";

export default async function PlayLayout({ children }: LayoutProps<"/play">) {
  const viewer = await requireViewer();
  return (
    // data-team: accents inside use the team colour (globals.css).
    <div {...teamThemeProps(viewer.team.colour)} className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
      {viewer.isDm && (
        <div className="glass mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent px-3 py-2 text-sm shadow-panel">
          <span>
            👁 You are the DM, viewing as <strong>{viewer.team.name}</strong>. You see exactly what this team sees. You can edit and submit its orders.
          </span>
          <form action={stopViewingAs} className="ml-auto">
            <Button variant="secondary" type="submit">
              Back to DM
            </Button>
          </form>
        </div>
      )}
      <header className="glass flex flex-wrap items-center gap-3 rounded-xl border border-border border-t-4 border-t-accent px-3 py-2.5 shadow-panel sm:px-4">
        <TeamEmblem team={viewer.team} size={30} />
        <h1 className="text-xl font-semibold sm:text-2xl">{viewer.team.name}</h1>
        <span className="text-sm text-muted">
          {viewer.game.name} · {viewer.isDm ? "DM" : viewer.displayName}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {!viewer.isDm && (
            <form action={logout}>
              <Button variant="secondary" type="submit">
                Leave
              </Button>
            </form>
          )}
        </div>
      </header>
      <NavLinks
        className="mt-3 border-b border-border pb-2"
        links={[
          { href: "/play", label: "Dashboard", exact: true },
          { href: "/play/map", label: "Map" },
          { href: "/play/orders", label: "Orders" },
          { href: "/play/results", label: "Results" },
          { href: "/play/units", label: "Units" },
          { href: "/play/regions", label: "Regions" },
          { href: "/play/inventory", label: "Inventory" },
          { href: "/play/trades", label: "Trades" },
          { href: "/play/rules", label: "Rules" },
          { href: "/help/player", label: "Help" },
        ]}
      />
      <div className="mt-4">{children}</div>
    </div>
  );
}
