import type { CSSProperties } from "react";
import { over, parseColour, readableOn, textOn, toHex, type Rgb } from "./contrast";

// A team's colours as CSS variables. Put them on a wrapper together with the
// data-team attribute and everything inside uses the team colour for accents
// (borders, highlights, active buttons, links), while backgrounds stay blue.
//
//   --team-color       the team's own colour (fills, borders, tokens)
//   --team-on          black or white text on top of it
//   --team-text-dark   the colour adjusted to read as text on the dark theme's panels
//   --team-text-light  the same for the light theme

/** The glass panel colours from globals.css (tokens.test.ts checks they match). */
export const CARD_DARK = "rgb(17 30 54 / 0.9)";
export const CARD_LIGHT = "rgb(255 255 255 / 0.9)";
/**
 * Text is checked against the worst case: a dark panel over a white part of
 * the map, or a light panel over a black part.
 */
export const PANEL_DARK_WORST: Rgb = over(CARD_DARK, [255, 255, 255]);
export const PANEL_LIGHT_WORST: Rgb = over(CARD_LIGHT, [0, 0, 0]);

export function teamThemeVars(colour: string): Record<string, string> {
  let rgb;
  try {
    rgb = parseColour(colour).rgb;
  } catch {
    rgb = parseColour("#4c8dff").rgb;
  }
  return {
    "--team-color": toHex(rgb),
    "--team-on": toHex(textOn(rgb)),
    "--team-text-dark": toHex(readableOn(rgb, PANEL_DARK_WORST)),
    "--team-text-light": toHex(readableOn(rgb, PANEL_LIGHT_WORST)),
  };
}

/** Props for a team-coloured wrapper: <div {...teamThemeProps(team.colour)}>. */
export function teamThemeProps(colour: string): { "data-team": ""; style: CSSProperties } {
  return { "data-team": "", style: teamThemeVars(colour) as CSSProperties };
}
