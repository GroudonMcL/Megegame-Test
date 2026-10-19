import { DmGameHeader } from "../DmGameHeader";

export default async function Layout({ children, params }: LayoutProps<"/dm/games/[gameId]/map">) {
  return <DmGameHeader gameId={(await params).gameId}>{children}</DmGameHeader>;
}
