"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { ON_MAP_STATUSES } from "@/engine/world/types";
import { Countdown } from "./Countdown";
import { regionTitle } from "./format";
import { MapKey } from "./MapKey";
import { MapSelectionContext, type MapSelection } from "./mapSelection";
import { QuickOrders } from "./QuickOrders";
import { ownerName, RegionDetails } from "./RegionDetails";
import { TeamMap } from "./TeamMap";
import { UnitDetails } from "./UnitDetails";

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
  /** Whether orders can be changed now, and why not. */
  ordersOpen: { open: boolean; reason: string };
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
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [focus, setFocus] = useState<{ nodeId: string; key: number } | null>(null);
  const router = useRouter();
  const panel = selection && sidePanelFor(selection, view, rules, info.ordersOpen, setSelection);

  // "Show on map" from a window: close the window, select the thing and centre the map on it.
  const showOnMap = (s: MapSelection) => {
    const regionId = s.kind === "region" ? s.id : s.kind === "unit" ? view.ownUnits.find((u) => u.id === s.id)?.regionId : view.otherUnits.find((u) => u.id === s.id)?.regionId;
    setSelection(s);
    if (regionId) setFocus((f) => ({ nodeId: regionId, key: (f?.key ?? 0) + 1 }));
    router.push("/play");
  };

  // A unit badge: one unit opens that unit, several open the region (which lists them).
  const onBadge = (regionId: string, owner: string) => {
    const units =
      owner === view.team.id
        ? view.ownUnits.filter((u) => u.regionId === regionId && ON_MAP_STATUSES.has(u.status)).map((u) => u.id)
        : view.otherUnits.filter((u) => u.regionId === regionId && (u.ownerTeamId ?? "wild") === owner).map((u) => u.id);
    if (units.length === 1) setSelection({ kind: owner === view.team.id ? "unit" : "other", id: units[0] });
    else setSelection({ kind: "region", id: regionId });
  };

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
      map={
        <TeamMap
          view={view}
          rules={rules}
          mapImage={mapImage}
          selectedId={panel?.regionId}
          onRegionClick={(id) => setSelection({ kind: "region", id })}
          onBadgeClick={onBadge}
          onBackgroundClick={() => setSelection(null)}
          className="h-full"
          bare
          focus={focus}
        />
      }
    >
      <MapSelectionContext value={showOnMap}>
        <WindowSlot tools={PLAYER_TOOLS} closeHref="/play">
          {children}
        </WindowSlot>
      </MapSelectionContext>
      {panel && (
        <SidePanel title={panel.title} onClose={() => setSelection(null)}>
          {panel.body}
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

/**
 * The side panel for what's selected, or null if it's gone (e.g. the unit
 * moved out of sight after a refresh). Shows only what the team's view holds.
 */
function sidePanelFor(
  sel: MapSelection,
  view: TeamView,
  rules: Ruleset,
  open: { open: boolean; reason: string },
  select: (s: MapSelection | null) => void,
): { title: ReactNode; body: ReactNode; regionId: string | null } | null {
  const regionLink = (id: string | null) => {
    const r = view.regions.find((x) => x.id === id);
    if (!r) return "off the map";
    return (
      <button type="button" className="text-left text-link underline-offset-2 hover:underline" onClick={() => select({ kind: "region", id: r.id })}>
        {regionTitle(r)}
      </button>
    );
  };

  if (sel.kind === "region") {
    const region = view.regions.find((r) => r.id === sel.id);
    if (!region) return null;
    return {
      title: regionTitle(region),
      regionId: region.id,
      body: (
        <>
          <RegionDetails region={region} view={view} rules={rules} showTitle={false} onUnitClick={(kind, id) => select({ kind, id })} />
          <QuickOrders rules={rules} target={{ kind: "region", region }} open={open} />
        </>
      ),
    };
  }

  if (sel.kind === "unit") {
    const unit = view.ownUnits.find((u) => u.id === sel.id);
    if (!unit) return null;
    const creature = rules.creatures.find((c) => c.id === unit.creatureId);
    return {
      title: unit.name || creature?.statBlock.name || "Unit",
      regionId: unit.regionId,
      body: (
        <>
          <UnitDetails unit={unit} rules={rules} regionLabel={regionLink(unit.regionId)} compact />
          <QuickOrders rules={rules} target={{ kind: "unit", unit }} open={open} />
          <Link href="/play/units" className="mt-3 inline-block text-xs text-link underline">
            All your units →
          </Link>
        </>
      ),
    };
  }

  const unit = view.otherUnits.find((u) => u.id === sel.id);
  if (!unit) return null;
  const owner = unit.ownerTeamId ? (view.teams.find((t) => t.id === unit.ownerTeamId) ?? null) : null;
  return {
    title: unit.creatureName,
    regionId: unit.regionId,
    body: (
      <>
        <p className="flex items-center gap-2">
          <TeamEmblem team={owner} size={22} />
          <span>
            {unit.creatureName} · <strong>{unit.ownerTeamId ? ownerName(view, unit.ownerTeamId) : "wild monster"}</strong>
            {unit.dead ? " · dead" : ""}
          </span>
        </p>
        <p className="mt-2">In {regionLink(unit.regionId)}</p>
        <p className="mt-2 text-xs text-muted">You can only make out its type and who it belongs to. {unit.ownerTeamId ? "" : "Once you've met a monster type, its stat block is in your Rules."}</p>
        <QuickOrders rules={rules} target={{ kind: "other", unit }} open={open} />
      </>
    ),
  };
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
