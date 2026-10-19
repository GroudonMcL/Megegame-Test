"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { logout } from "@/app/actions";
import { stopViewingAs } from "@/app/play/actions";
import { Icon } from "@/components/icons/Icon";
import { TeamEmblem, type EmblemTeam } from "@/components/icons/TeamEmblem";
import { Dock, MapShell, Toolbar, type Tool } from "@/components/shell/MapShell";
import { Modal } from "@/components/shell/Modal";
import { SidePanel } from "@/components/shell/SidePanel";
import { WindowSlot } from "@/components/shell/WindowSlot";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button, IconButton } from "@/components/ui";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import { Countdown } from "./Countdown";
import { regionTitle } from "./format";
import { MapKey } from "./MapKey";
import { RegionDetails } from "./RegionDetails";
import { TeamMap } from "./TeamMap";

// The player screen: the team's fogged map is always there; every other screen
// opens as a window over it, and clicking a region opens its details on the side.

export const PLAYER_TOOLS: Tool[] = [
  { id: "overview", href: "/play/overview", label: "Overview", icon: "overview", width: 760 },
  { id: "orders", href: "/play/orders", label: "Orders", icon: "orders", width: 980 },
  { id: "results", href: "/play/results", label: "Results", icon: "results", width: 680 },
  { id: "units", href: "/play/units", label: "Units", icon: "units", width: 720 },
  { id: "regions", href: "/play/regions", label: "Regions", icon: "regions", width: 680 },
  { id: "inventory", href: "/play/inventory", label: "Inventory", icon: "inventory", width: 720 },
  { id: "trades", href: "/play/trades", label: "Trades", icon: "trades", width: 780 },
  { id: "rules", href: "/play/rules", label: "Rules", icon: "rules", width: 880 },
  { id: "help", href: "/play/help", label: "Help", icon: "help", width: 720 },
];

export interface ToolbarInfo {
  team: EmblemTeam;
  gameName: string;
  displayName: string;
  isDm: boolean;
  round: { number: number; status: string; deadline: string | null } | null;
  orders: "submitted" | "draft" | "none";
  resources: { id: string; name: string; icon: string; amount: number }[];
}

export function PlayerShell({
  info,
  view,
  rules,
  mapImage,
  children,
}: {
  info: ToolbarInfo;
  view: TeamView;
  rules: Ruleset;
  mapImage: { width: number; height: number; url: string } | null;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const region = view.regions.find((r) => r.id === selected);

  const toolbar = (
    <Toolbar>
      <TeamEmblem team={info.team} size={30} />
      <div className="min-w-0 leading-tight">
        <p className="truncate font-semibold">{info.team.name}</p>
        <p className="hidden truncate text-xs text-muted sm:block">
          {info.gameName} · {info.isDm ? "DM" : info.displayName}
        </p>
      </div>
      <RoundChip info={info} />
      <ul className="hidden min-w-0 items-center gap-1 overflow-hidden lg:flex" aria-label="Resources">
        {info.resources.map((r) => (
          <li key={r.id} title={r.name} className="rounded-full border border-border bg-raised px-2 py-0.5 text-sm tabular-nums whitespace-nowrap">
            <span aria-hidden>{r.icon}</span> <span className="sr-only">{r.name}: </span>
            {Math.round(r.amount * 100) / 100}
          </li>
        ))}
      </ul>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {info.isDm && (
          <form action={stopViewingAs} className="flex items-center gap-2 rounded-full border border-accent px-1 py-0.5 pl-3 text-xs">
            <span className="hidden md:inline">
              <Icon name="eye" size={14} className="mr-1 inline align-[-2px]" />
              Viewing as this team
            </span>
            <Button type="submit" variant="secondary" className="px-2.5! py-1! text-xs">
              Back to DM
            </Button>
          </form>
        )}
        <ThemeToggle />
        {!info.isDm && (
          <IconButton label="Leave the game" onClick={() => setLeaving(true)}>
            <Icon name="logout" />
          </IconButton>
        )}
      </div>
    </Toolbar>
  );

  return (
    <MapShell
      toolbar={toolbar}
      dock={<Dock tools={PLAYER_TOOLS} closeHref="/play" />}
      map={<TeamMap view={view} rules={rules} mapImage={mapImage} selectedId={selected} onRegionClick={setSelected} onBackgroundClick={() => setSelected(null)} className="h-full" bare />}
    >
      <WindowSlot tools={PLAYER_TOOLS} closeHref="/play">
        {children}
      </WindowSlot>
      {region && (
        <SidePanel title={regionTitle(region)} onClose={() => setSelected(null)}>
          <RegionDetails region={region} view={view} rules={rules} showTitle={false} />
        </SidePanel>
      )}
      <MapKey view={view} />
      <Modal open={leaving} onClose={() => setLeaving(false)} title="Leave the game?">
        <p className="text-sm text-muted">You&apos;ll be signed out on this device. To come back, join again with your team&apos;s code.</p>
        <form action={logout} className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setLeaving(false)}>
            Stay
          </Button>
          <Button type="submit" variant="danger">
            Leave
          </Button>
        </form>
      </Modal>
    </MapShell>
  );
}

function RoundChip({ info }: { info: ToolbarInfo }) {
  const r = info.round;
  if (!r) return <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-xs text-muted sm:inline">Waiting to start</span>;
  const tone = info.orders === "submitted" ? "text-ok" : info.orders === "draft" ? "text-warn" : "text-muted";
  return (
    <Link
      href="/play/orders"
      className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-raised px-2.5 py-0.5 text-xs whitespace-nowrap hover:border-border-strong"
      title="Open your orders"
    >
      <span className="font-semibold">Round {r.number}</span>
      <span className="text-muted">{r.status}</span>
      {r.deadline && r.status === "open" && (
        <span className="hidden text-muted md:inline">
          · <Countdown deadline={r.deadline} />
        </span>
      )}
      <span className={tone}>
        ● <span className="hidden sm:inline">{info.orders === "submitted" ? "submitted" : info.orders === "draft" ? "draft" : "no orders"}</span>
      </span>
    </Link>
  );
}
