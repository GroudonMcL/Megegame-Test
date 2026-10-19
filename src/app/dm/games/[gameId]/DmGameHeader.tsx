import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/NavLinks";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { loadGame } from "./game";

/** The header and tabs of the DM's full-page screens (map editor, ruleset, history, settings). */
export async function DmGameHeader({ gameId, children }: { gameId: string; children: ReactNode }) {
  const game = await loadGame(gameId);
  const base = `/dm/games/${gameId}`;
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dm" className="text-link underline">
          ← All games
        </Link>
        <ThemeToggle className="ml-auto" />
      </div>
      <h1 className="mt-2 text-2xl font-semibold">{game.name}</h1>
      <NavLinks
        className="mt-3 border-b border-border pb-2"
        links={[
          { href: `${base}/world`, label: "World map" },
          { href: base, label: "Teams", exact: true },
          { href: `${base}/resolve`, label: "Resolve round" },
          { href: `${base}/diplomacy`, label: "Diplomacy" },
          { href: `${base}/map`, label: "Map editor" },
          { href: `${base}/ruleset`, label: "Ruleset" },
          { href: `${base}/history`, label: "History" },
          { href: `${base}/settings`, label: "Settings & export" },
          { href: "/help/dm", label: "Guide" },
        ]}
      />
      <div className="mt-4">{children}</div>
    </div>
  );
}
