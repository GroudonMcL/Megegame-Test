"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/icons/Icon";
import { IconButton } from "@/components/ui";
import { THEME_KEY } from "./themeScript";

// Switches between the dark theme (the default) and the light one. The choice
// is kept in this browser; THEME_SCRIPT applies it before the page paints.

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme ?? "dark",
    () => "dark",
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton
      label={`Switch to the ${next} theme`}
      className={className}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // Private browsing: the choice just isn't remembered.
        }
      }}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </IconButton>
  );
}
