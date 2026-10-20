"use client";

import { createContext, useContext } from "react";
import type { EmblemTeam } from "@/components/icons/TeamEmblem";
import type { TeamView } from "@/engine/world/teamView";

// Who is looking at the player screens, for the parts that change when the DM
// is editing as the team (the note option, extra DM controls), and the teams
// it has met (for lending units).

export interface ViewerInfo {
  isDm: boolean;
  teamName: string;
  /** Teams this team has met (it can trade with them and lend them units). */
  contacts?: EmblemTeam[];
  /** The team's view (inventory, units, regions), for the unit Edit window. */
  view?: TeamView;
}

export const ViewerInfoContext = createContext<ViewerInfo>({ isDm: false, teamName: "" });

export function useViewerInfo(): ViewerInfo {
  return useContext(ViewerInfoContext);
}
