import { describe, expect, it } from "vitest";
import { parseCsv, parseRegionCsv } from "./csv";
import { gridPositions, nextRegionCode } from "./codes";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes and newlines in cells", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });
  it("accepts semicolons and Windows line endings", () => {
    expect(parseCsv("a;b\r\n1;2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseRegionCsv", () => {
  it("reads the documented columns in any order", () => {
    const csv = [
      "Settleable,Region ID,Name,Description,Features,Ruin Name,Ruin Description,Dungeon Name,Dungeon Description",
      'No,A1,Fungal Forest,"Tall, glowing caps",Spores,,,The Hollow,A deep pit',
      "yes,A2,Old Dwarfhold,,,Gate Ruins,Broken gates,,",
    ].join("\n");
    const r = parseRegionCsv(csv);
    expect(r.problems).toEqual([]);
    expect(r.regions).toEqual([
      { code: "A1", name: "Fungal Forest", description: "Tall, glowing caps", features: "Spores", ruin: null, dungeon: { name: "The Hollow", description: "A deep pit" }, settleable: false },
      { code: "A2", name: "Old Dwarfhold", description: "", features: "", ruin: { name: "Gate Ruins", description: "Broken gates" }, dungeon: null, settleable: true },
    ]);
  });

  it("accepts a combined 'Ruin Name/Description' column", () => {
    const r = parseRegionCsv("Region ID,Ruin Name/Description\nB3,Watch Post: A collapsed tower\n");
    expect(r.regions[0].ruin).toEqual({ name: "Watch Post", description: "A collapsed tower" });
  });

  it("reports missing IDs and duplicates", () => {
    const r = parseRegionCsv("Region ID,Name\n,Nowhere\nA1,First\nA1,Second\n");
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].name).toBe("Second");
    expect(r.problems).toHaveLength(2);
  });

  it("refuses a file without a Region ID column", () => {
    expect(parseRegionCsv("Name\nX\n").problems[0]).toMatch(/Region ID/);
  });
});

describe("region codes and layout", () => {
  it("fills the next free code", () => {
    expect(nextRegionCode([])).toBe("A1");
    expect(nextRegionCode(["A1", "a2", "A4"])).toBe("A3");
  });
  it("places new nodes apart from existing ones", () => {
    const pts = gridPositions(5, [{ x: 0.1, y: 0.1 }]);
    expect(pts).toHaveLength(5);
    for (const p of pts) expect(Math.hypot(p.x - 0.1, p.y - 0.1)).toBeGreaterThanOrEqual(0.04);
  });
});
