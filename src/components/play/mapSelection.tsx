"use client";

import { createContext, useContext } from "react";
import { Icon } from "@/components/icons/Icon";
import { buttonClass } from "@/components/ui";

// What's open in the side panel: a region, one of the team's units, a unit
// of another side, or a move planned on the map (by its order's ID). The player shell owns it. "Show on map" in a window closes
// the window, opens the panel and centres the map on the thing.

export type MapSelection = { kind: "region"; id: string } | { kind: "unit"; id: string } | { kind: "other"; id: string } | { kind: "route"; id: string };

export const MapSelectionContext = createContext<(s: MapSelection) => void>(() => {});

export function useSelectOnMap() {
  return useContext(MapSelectionContext);
}

export function ShowOnMap({ selection, className = "" }: { selection: MapSelection; className?: string }) {
  const select = useSelectOnMap();
  return (
    <button type="button" className={buttonClass("secondary", `px-3! py-1.5! text-xs ${className}`)} onClick={() => select(selection)}>
      <Icon name="regions" size={14} /> Show on map
    </button>
  );
}
