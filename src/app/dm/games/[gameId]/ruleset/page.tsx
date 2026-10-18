import { redirect } from "next/navigation";

export default async function RulesetIndex({ params }: PageProps<"/dm/games/[gameId]/ruleset">) {
  const { gameId } = await params;
  redirect(`/dm/games/${gameId}/ruleset/settings`);
}
