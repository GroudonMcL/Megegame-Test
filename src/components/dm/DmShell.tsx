"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Dock, MapShell, Toolbar, type Tool } from "@/components/shell/MapShell";
import { WindowSlot } from "@/components/shell/WindowSlot";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// The DM's game screen: the World map (god view) is always there; Teams,
// Resolve, Diplomacy and Messages open as windows over it. The big editors (map editor,
// ruleset, history, settings) are still full pages, linked from the dock.

export function dmTools(gameId: string): Tool[] {
  const base = `/dm/games/${gameId}`;
  return [
    { id: "teams", href: base, exact: true, label: "Teams", icon: "units", width: 920 },
    { id: "resolve", href: `${base}/resolve`, label: "Resolve", icon: "resolve", width: 1120 },
    { id: "diplomacy", href: `${base}/diplomacy`, label: "Diplomacy", icon: "diplomacy", width: 900 },
    { id: "messages", href: `${base}/messages`, label: "Messages", icon: "messages", width: 860 },
    { id: "map", href: `${base}/map`, label: "Map editor", icon: "edit", page: true },
    { id: "ruleset", href: `${base}/ruleset`, label: "Ruleset", icon: "rules", page: true },
    { id: "history", href: `${base}/history`, label: "History", icon: "history", page: true },
    { id: "settings", href: `${base}/settings`, label: "Settings", icon: "settings", page: true },
    { id: "guide", href: "/help/dm", label: "Guide", icon: "help", page: true },
  ];
}

export function DmShell({
  gameId,
  gameName,
  round,
  unreadMessages,
  map,
  children,
}: {
  gameId: string;
  gameName: string;
  round: { number: number; status: string } | null;
  /** Messages from teams the DM hasn't read. */
  unreadMessages: number;
  map: ReactNode;
  children: ReactNode;
}) {
  const tools = dmTools(gameId);
  const closeHref = `/dm/games/${gameId}/world`;
  return (
    <MapShell
      toolbar={
        <Toolbar>
          <Link href="/dm" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-raised hover:text-foreground" title="All games">
            <Icon name="back" size={16} /> <span className="hidden sm:inline">All games</span>
          </Link>
          <h1 className="min-w-0 truncate font-semibold">{gameName}</h1>
          <span className="rounded-full border border-border bg-raised px-2.5 py-0.5 text-xs whitespace-nowrap">
            {round ? (
              <>
                <span className="font-semibold">Round {round.number}</span> <span className="text-muted">{round.status}</span>
              </>
            ) : (
              <span className="text-muted">No round yet</span>
            )}
          </span>
          <span className="hidden rounded-full border border-accent px-2.5 py-0.5 text-xs text-link sm:inline">DM</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </Toolbar>
      }
      dock={<Dock tools={tools} closeHref={closeHref} badges={{ messages: unreadMessages }} />}
      map={map}
    >
      <WindowSlot tools={tools} closeHref={closeHref}>
        {children}
      </WindowSlot>
    </MapShell>
  );
}
