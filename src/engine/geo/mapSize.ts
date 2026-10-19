// The map's size in pixels when no image has been uploaded (shapes are stored
// as fractions of it). Distances use height ÷ width, so the default matters.
export const DEFAULT_MAP_SIZE = { width: 2000, height: 1400 };

/** Map height ÷ width. */
export function mapAspect(image: { width: number | null; height: number | null } | null | undefined): number {
  return image?.width && image.height ? image.height / image.width : DEFAULT_MAP_SIZE.height / DEFAULT_MAP_SIZE.width;
}

/** A world's map scale, or the defaults (default map size, 200 miles across) for one without. */
export function mapScaleOf(world: { map?: { aspect: number; milesAcross: number } }): { aspect: number; milesAcross: number } {
  return world.map ?? { aspect: DEFAULT_MAP_SIZE.height / DEFAULT_MAP_SIZE.width, milesAcross: 200 };
}
