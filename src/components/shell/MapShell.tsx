"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";

// The map-first screen: a toolbar along the top, the map filling everything
// below it, a dock of tools on the left (along the bottom on phones), and a
// "desk" layer over the map where windows and side panels float.

export interface Tool {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  /** Default window width in pixels. */
  width?: number;
  /** Opens as a normal page instead of a window (e.g. the DM's ruleset editor). */
  page?: boolean;
  /** Only this exact path counts as the tool (for a tool at the root of a section). */
  exact?: boolean;
}

export function MapShell({ toolbar, dock, map, children }: { toolbar: ReactNode; dock: ReactNode; map: ReactNode; children?: ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col">
      {toolbar}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 bottom-16 sm:bottom-0">{map}</div>
        {dock}
        {/* Windows and panels float here; the layer itself lets clicks through to the map. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-16 sm:bottom-0 sm:left-[6rem]">{children}</div>
      </div>
    </div>
  );
}

/** The top bar: glass, full width. */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <header className="glass relative z-40 flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5 shadow-panel sm:gap-3 sm:px-3">{children}</header>
  );
}

/** Which tool a path belongs to (the longest matching href). */
export function activeTool(tools: Tool[], path: string): Tool | undefined {
  return [...tools].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || (!t.exact && path.startsWith(`${t.href}/`)));
}

/**
 * The tool buttons. The open tool is highlighted; pressing it again closes it
 * (goes to closeHref, the bare map).
 */
export function Dock({ tools, closeHref, extra }: { tools: Tool[]; closeHref: string; extra?: ReactNode }) {
  const path = usePathname();
  const active = activeTool(tools, path);
  return (
    <nav
      aria-label="Tools"
      className="glass absolute inset-x-0 bottom-0 z-30 flex h-16 items-stretch gap-0.5 overflow-x-auto border-t border-border px-1 shadow-panel sm:inset-x-auto sm:top-3 sm:bottom-auto sm:left-3 sm:h-auto sm:max-h-[calc(100%-1.5rem)] sm:w-20 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:rounded-xl sm:border sm:py-1"
    >
      {tools.map((t) => {
        const on = active?.id === t.id;
        return (
          <Link
            key={t.id}
            href={on && !t.page ? closeHref : t.href}
            aria-current={on ? "page" : undefined}
            title={on && !t.page ? `Close ${t.label}` : t.label}
            className={`flex min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[0.7rem] leading-tight font-medium ${
              on ? "bg-accent text-accent-foreground shadow-sm" : "text-muted hover:bg-raised hover:text-foreground"
            }`}
          >
            <Icon name={t.icon} size={20} />
            <span className="max-w-full truncate">{t.label}</span>
          </Link>
        );
      })}
      {extra}
    </nav>
  );
}
