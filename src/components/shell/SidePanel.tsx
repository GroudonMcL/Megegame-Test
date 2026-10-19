"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { IconButton } from "@/components/ui";
import { useEscape } from "./useEscape";

// Information about something on the map (a region, later a unit), docked on
// the right over the map. Close with × or Escape. On narrow screens it sits
// along the bottom instead.

export function SidePanel({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(true, onClose);
  return (
    <aside
      aria-label="Details"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex max-h-[55%] flex-col overflow-hidden rounded-t-xl border border-border shadow-xl sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-16 sm:max-h-none sm:w-80 sm:rounded-xl"
    >
      <div className="glass-strong absolute inset-0 -z-10" aria-hidden />
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        <IconButton label="Close details" onClick={onClose} className="h-8 w-8">
          <Icon name="close" size={18} />
        </IconButton>
      </header>
      <div className="@container min-h-0 flex-1 overflow-auto overscroll-contain p-3 text-sm">{children}</div>
    </aside>
  );
}
