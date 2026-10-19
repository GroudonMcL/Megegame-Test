import { NavLinks } from "@/components/NavLinks";
import { Button } from "@/components/ui";
import { requireViewer } from "@/lib/viewer";
import { logout } from "../actions";
import { stopViewingAs } from "./actions";

export default async function PlayLayout({ children }: LayoutProps<"/play">) {
  const viewer = await requireViewer();
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
      {viewer.isDm && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent bg-card px-3 py-2 text-sm">
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
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: viewer.team.colour }} aria-hidden />
        <h1 className="text-xl font-semibold sm:text-2xl">{viewer.team.name}</h1>
        <span className="text-sm text-muted">
          {viewer.game.name} · {viewer.isDm ? "DM" : viewer.displayName}
        </span>
        {!viewer.isDm && (
          <form action={logout} className="ml-auto">
            <Button variant="secondary" type="submit">
              Leave
            </Button>
          </form>
        )}
      </div>
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
