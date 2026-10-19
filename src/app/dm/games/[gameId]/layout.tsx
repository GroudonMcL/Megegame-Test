import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { NavLinks } from "@/components/NavLinks";
import { requireDm } from "@/lib/session";

export default async function GameLayout({ children, params }: LayoutProps<"/dm/games/[gameId]">) {
  await requireDm();
  const { gameId } = await params;
  if (!z.uuid().safeParse(gameId).success) notFound();
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  if (!game) notFound();
  const base = `/dm/games/${gameId}`;
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <p className="text-sm">
        <Link href="/dm" className="text-accent underline">
          ← All games
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{game.name}</h1>
      <NavLinks
        className="mt-3 border-b border-border pb-2"
        links={[
          { href: base, label: "Teams", exact: true },
          { href: `${base}/resolve`, label: "Resolve round" },
          { href: `${base}/world`, label: "World" },
          { href: `${base}/map`, label: "Map editor" },
          { href: `${base}/ruleset`, label: "Ruleset" },
          { href: `${base}/diplomacy`, label: "Diplomacy" },
          { href: `${base}/history`, label: "History" },
          { href: `${base}/settings`, label: "Settings & export" },
          { href: "/help/dm", label: "Guide" },
        ]}
      />
      <div className="mt-4">{children}</div>
    </div>
  );
}
