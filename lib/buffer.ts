import turfBuffer from "@turf/buffer";

/**
 * On-the-fly buffers around blocker polygons.
 *
 * Buffering all 294 restoration areas takes roughly 400 ms, which is far too
 * slow to sit behind a slider. Two things make it usable:
 *
 *   1. Only features overlapping the current view are buffered. Zoomed in on a
 *      lease — the case that matters — that is a handful of shapes and the work
 *      is imperceptible.
 *   2. The view is padded by the buffer distance first, so a blocker just off
 *      the edge still contributes the part of its ring that reaches on-screen.
 *
 * Feature bounding boxes are computed once when the category loads, because
 * recomputing them on every slider tick would cost more than the buffering.
 */

export type BBox = [number, number, number, number];

export type IndexedCategory = {
  features: GeoJSON.Feature[];
  boxes: BBox[];
};

const FEET_PER_KM = 3280.839895;
/** Degrees of latitude per foot; longitude is corrected by latitude at use. */
const DEG_LAT_PER_FOOT = 1 / 364000;

export function bboxOfGeometry(geometry: GeoJSON.Geometry): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number") {
      const [lon, lat] = node as number[];
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  return [west, south, east, north];
}

export function indexCategory(data: GeoJSON.FeatureCollection): IndexedCategory {
  const features = data.features ?? [];
  return { features, boxes: features.map((f) => bboxOfGeometry(f.geometry)) };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function bufferInView(
  indexed: IndexedCategory,
  feet: number,
  view: BBox,
): GeoJSON.FeatureCollection {
  if (!indexed || feet <= 0 || indexed.features.length === 0) return EMPTY;

  const [west, south, east, north] = view;
  const padLat = feet * DEG_LAT_PER_FOOT;
  // Longitude degrees shrink with latitude, so pad by more of them further north.
  const padLon = padLat / Math.max(0.2, Math.cos(((north + south) / 2) * (Math.PI / 180)));

  const selected: GeoJSON.Feature[] = [];
  for (let i = 0; i < indexed.features.length; i++) {
    const [fw, fs, fe, fn] = indexed.boxes[i];
    if (fe < west - padLon || fw > east + padLon) continue;
    if (fn < south - padLat || fs > north + padLat) continue;
    selected.push(indexed.features[i]);
  }
  if (selected.length === 0) return EMPTY;

  try {
    const out = turfBuffer(
      { type: "FeatureCollection", features: selected } as GeoJSON.FeatureCollection,
      feet / FEET_PER_KM,
      { units: "kilometers", steps: 8 },
    );
    return (out as GeoJSON.FeatureCollection) ?? EMPTY;
  } catch {
    // A degenerate ring should not take the whole overlay down.
    return EMPTY;
  }
}
