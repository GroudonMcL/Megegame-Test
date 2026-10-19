import { z } from "zod";

// How the map looks in 3D (and, for darkness, in 2D): how tall the height map
// is drawn, and the lighting. The DM sets these in the map editor; every team
// sees the same sky. The sun is a point light above the map, placed by its
// bearing (0° = the top of the map, 90° = the right) and height above the horizon.

const colour = z.string().regex(/^#[0-9a-f]{6}$/i);

export const MapLook = z.object({
  /** Height of the highest point (white in the height map), as a fraction of the map's width. */
  relief: z.number().min(0).max(0.3).default(0.05),
  sunColour: colour.default("#fff1d6"),
  /** Bearing of the sun in degrees: 0 = top of the map, 90 = right. */
  sunBearing: z.number().min(0).max(360).default(135),
  /** Height of the sun above the horizon in degrees. */
  sunElevation: z.number().min(5).max(90).default(40),
  /** 1 = full sun: flat ground facing the sun shows the map's own colours (with the sky's light). */
  sunIntensity: z.number().min(0).max(3).default(1),
  /** Light from the sky, everywhere (fills in shadows). */
  ambientColour: colour.default("#8fa3c8"),
  ambientIntensity: z.number().min(0).max(2).default(0.45),
  /** 0 = full daylight, 1 = deep night: dims every light and darkens the 2D map too. */
  darkness: z.number().min(0).max(1).default(0),
  /** Hills cast shadows. */
  shadows: z.boolean().default(true),
});
export type MapLook = z.infer<typeof MapLook>;

export const DEFAULT_MAP_LOOK: MapLook = MapLook.parse({});

/** Reads a stored look, filling in anything missing or invalid with the defaults. */
export function parseMapLook(v: unknown): MapLook {
  const obj = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(MapLook.shape) as (keyof MapLook)[]) {
    const field = MapLook.shape[key].safeParse(obj[key]);
    out[key] = field.success ? field.data : DEFAULT_MAP_LOOK[key];
  }
  return out as MapLook;
}

/** How much the lights are dimmed by darkness (1 = not at all). */
export function lightFactor(look: MapLook): number {
  return 1 - 0.85 * look.darkness;
}

/** Where the sun is, as a direction (x right, y up, z towards the bottom of the map), length 1. */
export function sunDirection(look: MapLook): [number, number, number] {
  const b = (look.sunBearing * Math.PI) / 180;
  const e = (look.sunElevation * Math.PI) / 180;
  return [Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)];
}

/** What a map view needs for 3D: the height map's address (null = flat) and the look. */
export interface Map3dInfo {
  heightUrl: string | null;
  look: MapLook;
}
