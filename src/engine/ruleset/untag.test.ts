import { describe, expect, it } from "vitest";
import { buildPreset } from "@/presets";
import { dropUnitRequirements } from "./untag";

describe("dropping unit-type requirements", () => {
  it("lets any unit take an action that needed a tagged one, keeping its other requirements", () => {
    const { actions, changed } = dropUnitRequirements([
      { name: "Raid", requirements: [{ type: "unitWithTag", tag: "Regiment" }, { type: "regionOwner", owner: "other" }], inputs: [{ type: "unit", tag: "Regiment" }, { type: "region" }] },
      { name: "Build", requirements: [{ type: "regionOwner", owner: "self" }], inputs: [{ type: "region" }] },
    ]);
    expect(changed).toEqual(["Raid"]);
    expect(actions[0].requirements).toEqual([{ type: "regionOwner", owner: "other" }]);
    expect(actions[0].inputs).toEqual([{ type: "unit" }, { type: "region" }]);
    expect(actions[1]).toEqual({ name: "Build", requirements: [{ type: "regionOwner", owner: "self" }], inputs: [{ type: "region" }] });
  });

  it("has nothing left to drop in the Utterdark preset", () => {
    expect(dropUnitRequirements(buildPreset("utterdark").actionTypes).changed).toEqual([]);
  });
});
