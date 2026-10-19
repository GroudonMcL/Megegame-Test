import type { Metadata } from "next";
import { PlayerGuideContent } from "./PlayerGuideContent";

export const metadata: Metadata = { title: "Player guide" };

export default function PlayerGuide() {
  return <PlayerGuideContent />;
}
