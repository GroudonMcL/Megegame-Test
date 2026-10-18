import { NavLinks } from "@/components/NavLinks";
import { RULESET_TABS } from "@/components/editor/tabs";

export default async function RulesetLayout({ children, params }: LayoutProps<"/dm/games/[gameId]/ruleset">) {
  const { gameId } = await params;
  return (
    <div>
      <NavLinks className="mb-4 flex-wrap" links={RULESET_TABS.map((t) => ({ href: `/dm/games/${gameId}/ruleset/${t.slug}`, label: t.label }))} />
      {children}
    </div>
  );
}
