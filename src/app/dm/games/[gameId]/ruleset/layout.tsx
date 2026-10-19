import { NavLinks } from "@/components/NavLinks";
import { RULESET_TABS } from "@/components/editor/tabs";
import { DmGameHeader } from "../DmGameHeader";

export default async function RulesetLayout({ children, params }: LayoutProps<"/dm/games/[gameId]/ruleset">) {
  const { gameId } = await params;
  return (
    <DmGameHeader gameId={gameId}>
      <NavLinks className="mb-4 flex-wrap" links={RULESET_TABS.map((t) => ({ href: `/dm/games/${gameId}/ruleset/${t.slug}`, label: t.label }))} />
      {children}
    </DmGameHeader>
  );
}
