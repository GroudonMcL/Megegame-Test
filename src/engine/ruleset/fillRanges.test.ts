import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { fillRanges, presetRanges } from "./fillRanges";
import { rangeFromText } from "./range";
import type { ActionProfile } from "./statblock";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("ranges", () => {
  it("reads them from action text", () => {
    const attack: ActionProfile = { kind: "attack", attackType: "ranged", toHit: { ability: "dex", proficient: true, flat: 0 }, damage: [] };
    expect(rangeFromText("Ranged Attack Roll: +9, range 120 feet. Hit: 13 (3d8)", attack)).toEqual({ normal: 120 });
    expect(rangeFromText("Ranged Attack Roll: +4, range 80/320 ft. Hit: 5", attack)).toEqual({ normal: 80, long: 320 });
    expect(rangeFromText("Melee Attack Roll: +4, reach 5 ft.", { ...attack, attackType: "melee" } as ActionProfile)).toBeUndefined();
  });

  it("fills in an old game's missing ranges from the text and the preset, keeping the DM's own", () => {
    const preset = buildPreset("utterdark");
    const old: any = JSON.parse(JSON.stringify({ creatures: preset.creatures, spells: preset.spells, items: preset.items }, (k, v) => (k === "range" ? undefined : v)));
    const scout = old.creatures.find((c: any) => c.id === "scout");
    scout.statBlock.actions.find((a: any) => a.name === "Longbow").profile.range = { normal: 100 };
    const { data, changed } = fillRanges(old, presetRanges(preset));
    const action = (id: string, name: string) => data.creatures.find((c: any) => c.id === id).statBlock.actions.find((a: any) => a.name === name).profile.range;
    expect(action("scout", "Longbow")).toEqual({ normal: 100 });
    expect(action("tough", "Heavy Crossbow")).toEqual({ normal: 100, long: 400 });
    expect(data.spells.find((s: any) => s.id === "blast").profile.range).toEqual({ normal: 60 });
    expect(data.spells.find((s: any) => s.id === "faerie-fire").profile.range).toEqual({ normal: 60 });
    expect(data.items.find((i: any) => i.id === "fire-bombs").effects[0].action.profile.range).toEqual({ normal: 20, long: 60 });
    expect(changed).toContain("Tough: Heavy Crossbow 100/400 ft");
    expect(changed.some((c) => c.startsWith("Scout: Longbow"))).toBe(false);
    // Running it again changes nothing.
    expect(fillRanges(data, presetRanges(preset))).toEqual({ data, changed: [] });
  });
});
