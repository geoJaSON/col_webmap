/**
 * Reference layers — restoration areas and any other blocker type that is
 * context rather than a COL application.
 *
 * Layers are grouped into *categories* by scripts/import_layers.py: one
 * category is one blocker type, sharing a colour and a buffer distance, and
 * arriving as a single combined GeoJSON. Adding a source is a shapefile plus a
 * line in layers.config.json.
 *
 * Fetched at runtime rather than bundled so a large category never lands in
 * the JavaScript payload.
 */

export type LayerCategory = {
  id: string;
  label: string;
  color: string;
  /** Default for the buffer slider, in feet. 0 means start with no buffer. */
  bufferFeet: number;
  file: string;
  features: number;
  sources: string[];
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  sizeKb: number;
};

export async function fetchCategories(): Promise<LayerCategory[]> {
  try {
    const response = await fetch("/layers/index.json", { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? (data as LayerCategory[]) : [];
  } catch {
    // No reference layers is a normal state, not a failure worth surfacing.
    return [];
  }
}

export async function fetchCategoryGeoJSON(category: LayerCategory) {
  const response = await fetch(`/layers/${category.file}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Could not load ${category.label}.`);
  return response.json();
}
