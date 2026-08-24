/**
 * Ring parsing, validation, and area for the shape editor.
 *
 * Shared by the browser (live preview while editing) and the API route (the
 * authority that decides what actually gets stored), so the number you see
 * before saving is the number that gets saved.
 */

export type Ring = [number, number][];

/** WGS84 authalic radius -- the sphere with the same surface area as the ellipsoid. */
const EARTH_RADIUS_M = 6371007.2;
const SQ_M_PER_ACRE = 4046.8564224;

/** Roughly the Texas coast, used only to warn about obviously wrong input. */
const PLAUSIBLE = { west: -98.5, east: -93.0, south: 25.5, north: 31.0 };

export type ParseResult =
  | { ok: true; points: Ring; order: "lat-lon" | "lon-lat"; warnings: string[] }
  | { ok: false; error: string };

/**
 * Pull a ring out of pasted text.
 *
 * Deliberately forgiving about separators: the source spreadsheets use commas
 * between the pair and runs of spaces between pairs, sometimes with the comma
 * missing entirely, and people paste one pair per line. So rather than parse
 * structure, take every number in order and pair them up.
 */
export function parseCoordinateText(text: string): ParseResult {
  const values = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

  if (values.length === 0) return { ok: false, error: "No coordinates found." };
  if (values.length % 2 !== 0) {
    return {
      ok: false,
      error: `Found ${values.length} numbers — coordinates have to come in pairs.`,
    };
  }

  const pairs: [number, number][] = [];
  for (let i = 0; i < values.length; i += 2) pairs.push([values[i], values[i + 1]]);

  // Latitude can never exceed 90, so on this coast the value beyond ±90 is the
  // longitude. Decide once for the whole paste by majority rather than per
  // pair, so one malformed line cannot flip the ordering of the rest.
  let latFirst = 0;
  let lonFirst = 0;
  for (const [a, b] of pairs) {
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) lonFirst++;
    else if (Math.abs(b) > 90 && Math.abs(a) <= 90) latFirst++;
  }
  const order: "lat-lon" | "lon-lat" = lonFirst > latFirst ? "lon-lat" : "lat-lon";

  const points: Ring = pairs.map(([a, b]) =>
    order === "lat-lon" ? [b, a] : [a, b],
  );

  const warnings: string[] = [];
  if (latFirst > 0 && lonFirst > 0) {
    warnings.push("Some pairs looked reversed; read them all as " + order + ".");
  }
  const outside = points.filter(
    ([lon, lat]) =>
      lon < PLAUSIBLE.west ||
      lon > PLAUSIBLE.east ||
      lat < PLAUSIBLE.south ||
      lat > PLAUSIBLE.north,
  ).length;
  if (outside > 0) {
    warnings.push(
      `${outside} point${outside === 1 ? " is" : "s are"} outside the Texas coast — check the order.`,
    );
  }

  return { ok: true, points, order, warnings };
}

/** Shoelace on [lon, lat]. Positive = counter-clockwise. */
export function signedArea(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    total += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return total / 2;
}

function segmentsCross(a1: number[], a2: number[], b1: number[], b2: number[]): boolean {
  const orient = (p: number[], q: number[], r: number[]) => {
    const v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : 2;
  };
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  return o1 !== o2 && o3 !== o4;
}

/** True if any two non-adjacent edges cross -- a bowtie. */
export function selfIntersects(ring: Ring): boolean {
  const edges: [number[], number[]][] = [];
  for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i], ring[i + 1]]);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue;
      if (segmentsCross(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) return true;
    }
  }
  return false;
}

/**
 * Turn loose points into a storable ring: drop consecutive duplicates, drop a
 * repeated closing point, close it, and wind counter-clockwise per RFC 7946.
 */
export function normalizeRing(points: Ring): Ring {
  const deduped: Ring = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) deduped.push(point);
  }
  // A pasted ring often already repeats its first point.
  const first = deduped[0];
  const last = deduped[deduped.length - 1];
  if (deduped.length > 1 && first[0] === last[0] && first[1] === last[1]) deduped.pop();

  let closed: Ring = [...deduped, deduped[0]];
  if (signedArea(closed) < 0) closed = closed.slice().reverse();
  return closed;
}

/**
 * Area on a sphere via spherical excess. Checked against the acreages in the
 * source workbook: 75 of 78 agree within 0.5%.
 */
export function areaAcres(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    total +=
      dLon *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  const sqMeters = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return sqMeters / SQ_M_PER_ACRE;
}

export type Validation = { ok: true; ring: Ring; warnings: string[] } | { ok: false; error: string };

/** The single gate every new shape passes through, in the browser and on the server. */
export function validateRing(points: Ring): Validation {
  if (points.length < 3) {
    return { ok: false, error: `A polygon needs at least 3 corners; got ${points.length}.` };
  }
  const ring = normalizeRing(points);
  if (ring.length - 1 < 3) {
    return { ok: false, error: "Too many repeated points to form a polygon." };
  }
  const warnings: string[] = [];
  if (selfIntersects(ring)) {
    return {
      ok: false,
      error: "Those corners cross over themselves. Reorder them to trace the outline.",
    };
  }
  if (areaAcres(ring) > 100) {
    warnings.push("Over 100 acres — TPWD caps a Certificate of Location at 100.");
  }
  return { ok: true, ring, warnings };
}

/** Render a ring back to the lat, lon text people paste around. */
export function formatRing(ring: Ring, order: "lat-lon" | "lon-lat" = "lat-lon"): string {
  const points = ring.slice(0, -1); // drop the repeated closing point
  return points
    .map(([lon, lat]) =>
      order === "lat-lon" ? `${lat.toFixed(6)}, ${lon.toFixed(6)}` : `${lon.toFixed(6)}, ${lat.toFixed(6)}`,
    )
    .join("\n");
}
