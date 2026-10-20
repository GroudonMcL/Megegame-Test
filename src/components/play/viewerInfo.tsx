"use client";

import { createContext, useContext } from "react";

// Who is looking at the player screens, for the parts that change when the DM
// is editing as the team (the note option, extra DM controls).

export interface ViewerInfo {
  isDm: boolean;
  teamName: string;
}

export const ViewerInfoContext = createContext<ViewerInfo>({ isDm: false, teamName: "" });

export function useViewerInfo(): ViewerInfo {
  return useContext(ViewerInfoContext);
}
