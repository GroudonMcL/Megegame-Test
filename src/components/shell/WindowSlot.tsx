"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { activeTool, type Tool } from "./MapShell";
import { ToolWindow } from "./ToolWindow";

// Shows the current page in a window over the map. Each tool is its own page
// (so it always shows fresh data, and links and the back button work);
// closing the window goes back to the bare map.

export function WindowSlot({ tools, closeHref, children }: { tools: Tool[]; closeHref: string; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  if (path === closeHref) return null;
  const tool = activeTool(tools, path);
  return (
    <ToolWindow key={tool?.id ?? path} id={tool?.id ?? path} title={tool?.label ?? "Details"} icon={tool?.icon} defaultWidth={tool?.width} onClose={() => router.push(closeHref)}>
      {children}
    </ToolWindow>
  );
}
