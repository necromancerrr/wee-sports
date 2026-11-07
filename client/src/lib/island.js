/** Authored scenery and normalized geometry only. Game names, capacity and
 * availability belong to the sport catalog and shared registry, not the map. */
export const MAIN_ISLAND = {
  id: 'resort',
  assetVersion: 1,
  image: {src: '/island/homepage.webp', width: 1672, height: 941},
  landing: {src: '/island/landing.webp', width: 1672, height: 941},
  venues: [
    {sportId: 'tennis', label: {x: .265, y: .515}, anchor: {x: .268, y: .673}},
    {sportId: 'bowling', label: {x: .79, y: .32}, anchor: {x: .79, y: .413}},
    {sportId: 'golf', label: {x: .238, y: .19}, anchor: {x: .24, y: .315}},
    {sportId: 'table-tennis', label: {x: .61, y: .22}, anchor: {x: .64, y: .375}},
  ],
  neighbors: [],
  // Future art reservation, deliberately absent from the sport catalog and
  // host actions. Pool means billiards, not a swimming attraction.
  reservedSpaces: [{id: 'east-billiards', use: 'billiards-lounge',
    bounds: {x: .86, y: .47, width: .12, height: .19}}],
};

export const ISLAND_REGIONS = {[MAIN_ISLAND.id]: MAIN_ISLAND};

/** Contain the complete image. Scenery, connector endpoints and controls all
 * use this rectangle, including letterboxed and portrait layouts. */
export function fitIsland(viewportWidth, viewportHeight, image = MAIN_ISLAND.image) {
  if (![viewportWidth, viewportHeight, image.width, image.height].every(Number.isFinite) ||
    viewportWidth <= 0 || viewportHeight <= 0 || image.width <= 0 || image.height <= 0) {
    return {x: 0, y: 0, width: 0, height: 0, scale: 0};
  }
  const scale = Math.min(viewportWidth / image.width, viewportHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height, scale};
}

export function islandPoint(point, rect) {
  return {x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height};
}

/** Keep an accessible Games list for every catalog entry. This split also
 * exposes new playable games that have no authored marker yet. */
export function presentIslandSports(sports, region = MAIN_ISLAND) {
  const byId = new Map(sports.map(sport => [sport.id, sport]));
  const venues = region.venues.filter(venue => byId.has(venue.sportId))
    .map(venue => ({...venue, sport: byId.get(venue.sportId)}));
  const mappedIds = new Set(venues.map(venue => venue.sportId));
  return {venues, unmapped: sports.filter(sport => sport.open && !mappedIds.has(sport.id))};
}
