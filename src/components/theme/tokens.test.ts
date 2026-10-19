import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEAM_COLOURS } from "../teamColours";
import { contrast, over, parseColour, type Rgb } from "./contrast";
import { CARD_DARK, CARD_LIGHT, PANEL_DARK_WORST, PANEL_LIGHT_WORST, teamThemeVars } from "./teamTheme";

// Reads the design tokens from globals.css and checks text contrast (WCAG AA:
// 4.5:1 for body text), including on glass panels over the brightest or
// darkest part of a map image.

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const dark = block('[data-theme="dark"]');
const light = { ...dark, ...block('[data-theme="light"]') };
const rgb = (c: string) => parseColour(c).rgb;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

const TEXT = ["--foreground", "--muted", "--link", "--danger", "--ok", "--warn"];

describe.each([
  ["dark", dark, WHITE],
  ["light", light, BLACK],
] as const)("%s theme", (_name, t, worstMap) => {
  const page = rgb(t["--background"]);
  const surfaces: [string, Rgb][] = [
    ["page", page],
    ["page glow", rgb(t["--page-top"])],
    ["panel on page", over(t["--card"], page)],
    ["panel over the map", over(t["--card"], worstMap)],
    ["raised", rgb(t["--raised"])],
  ];

  it.each(TEXT)("%s is readable on every surface", (token) => {
    for (const [, s] of surfaces) expect(contrast(rgb(t[token]), s)).toBeGreaterThanOrEqual(4.5);
  });

  it("accent buttons are readable", () => {
    expect(contrast(rgb(t["--accent-foreground"]), rgb(t["--accent"]))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("team colours", () => {
  it("matches the panel colours in globals.css", () => {
    expect(dark["--card"]).toBe(CARD_DARK);
    expect(light["--card"]).toBe(CARD_LIGHT);
  });

  it.each([...TEAM_COLOURS, "#ffff00", "#000080", "#101010", "#fafafa"])("%s gives readable text and button labels", (c) => {
    const v = teamThemeVars(c);
    expect(contrast(rgb(v["--team-on"]), rgb(v["--team-color"]))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(v["--team-text-dark"]), PANEL_DARK_WORST)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(v["--team-text-light"]), PANEL_LIGHT_WORST)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back for a broken colour", () => {
    expect(teamThemeVars("nonsense")["--team-color"]).toBe("#4c8dff");
  });
});
