import { DmGameHeader } from "../DmGameHeader";

export default async function Layout({ children, params }: LayoutProps<"/dm/games/[gameId]/history">) {
  return <DmGameHeader gameId={(await params).gameId}>{children}</DmGameHeader>;
}
