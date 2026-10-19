import { requireDm } from "@/lib/session";
import { loadGame } from "./game";

// Every page of one game: DM only, and the game must exist. The map-shell
// screens (Teams, Resolve, Diplomacy, World) get their layout from (shell)/;
// the full pages (map editor, ruleset, history, settings) use DmGameHeader.

export default async function GameLayout({ children, params }: LayoutProps<"/dm/games/[gameId]">) {
  await requireDm();
  await loadGame((await params).gameId);
  return children;
}
