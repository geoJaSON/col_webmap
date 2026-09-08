/** Static polling data shipped with this map. No database calls or user tokens. */
export const POLLING_SNAPSHOT_MIN_ZOOM = 14;

export type SnapshotChunk = { x: number; y: number; features: number; bytes: number };
export type PollingSnapshot = {
  version: 1;
  snapshotId: string;
  createdAt: string;
  features: number;
  unleasedFeatures: number;
  colFeatures: number;
  chunkZoom: number;
  minZoom: number;
  chunks: SnapshotChunk[];
};

export type SnapshotState = {
  metadata: PollingSnapshot | null;
  loading: boolean;
  error: string | null;
};

export async function fetchPollingSnapshot(signal: AbortSignal): Promise<PollingSnapshot> {
  const response = await fetch("/polling/index.json", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not load the polling snapshot. Toggle the layer to retry.");
  const data = await response.json();
  if (data.version !== 1 || !/^[a-f0-9]{16}$/.test(data.snapshotId) ||
      !Number.isInteger(data.chunkZoom) || data.chunkZoom < 0 || data.chunkZoom > 20 ||
      !Array.isArray(data.chunks) || !data.chunks.every((c: SnapshotChunk) =>
        Number.isInteger(c.x) && Number.isInteger(c.y) && c.features > 0)) {
    throw new Error("The polling snapshot index is invalid.");
  }
  return data as PollingSnapshot;
}

/** Use only published chunks; an empty area never results in a missing-file request. */
export function chunksInView(snapshot: PollingSnapshot, view: [number, number, number, number]) {
  const n = 2 ** snapshot.chunkZoom;
  const x = (lon: number) => ((lon + 180) / 360) * n;
  const y = (lat: number) => {
    const radians = (Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI) / 180;
    return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * n;
  };
  // Small overlap loads dots whose radius reaches across the viewport edge.
  const left = x(view[0]) - 0.02;
  const right = x(view[2]) + 0.02;
  const top = y(view[3]) - 0.02;
  const bottom = y(view[1]) + 0.02;
  return snapshot.chunks.filter((chunk) =>
    chunk.x + 1 >= left && chunk.x <= right && chunk.y + 1 >= top && chunk.y <= bottom);
}

export class PollingSnapshotCache {
  private readonly cached = new Map<string, GeoJSON.FeatureCollection>();

  constructor(private readonly snapshot: PollingSnapshot) {}

  async load(view: [number, number, number, number], signal: AbortSignal): Promise<GeoJSON.FeatureCollection> {
    const chunks = chunksInView(this.snapshot, view);
    const features: GeoJSON.Feature[] = [];
    // Bound network concurrency and memory while moving along the coast.
    for (let i = 0; i < chunks.length; i += 4) {
      signal.throwIfAborted();
      const batch = await Promise.all(chunks.slice(i, i + 4).map(async (chunk) => {
        const key = `${chunk.x}-${chunk.y}`;
        let data = this.cached.get(key);
        if (!data) {
          const response = await fetch(`/polling/${this.snapshot.snapshotId}/${key}.geojson`, {
            cache: "force-cache", signal,
          });
          if (!response.ok) throw new Error("Some polling points could not load. Toggle the layer to retry.");
          data = await response.json() as GeoJSON.FeatureCollection;
          if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length !== chunk.features) {
            throw new Error("The polling snapshot is incomplete. Toggle the layer to retry.");
          }
        }
        this.cached.delete(key);
        this.cached.set(key, data);
        while (this.cached.size > 32) this.cached.delete(this.cached.keys().next().value!);
        return data;
      }));
      for (const data of batch) features.push(...data.features);
    }
    signal.throwIfAborted();
    return { type: "FeatureCollection", features };
  }
}
