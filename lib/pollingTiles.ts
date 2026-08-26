import maplibregl from "maplibre-gl";

/**
 * Polling points come from the platform's own `mvt_polling_points` function,
 * which returns a Mapbox Vector Tile — but as base64 text inside a JSON
 * string, because PostgREST will not serve the underlying type as
 * application/octet-stream.
 *
 * A MapLibre custom protocol handles that in the browser: fetch the tile as
 * the signed-in user, decode, hand MapLibre the bytes. Nothing is proxied
 * through this app's server, so the person's access token never leaves their
 * machine except to go to Supabase, and the function's own per-user filtering
 * decides what comes back.
 */

export const POLLING_PROTOCOL = "polling";

type TokenSource = () => string | null;

let registered = false;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Registers `polling://` once. `getToken` is read at request time rather than
 * captured, so signing in or out takes effect on the next tile without
 * re-registering anything.
 */
export function registerPollingProtocol(getToken: TokenSource) {
  if (registered) return;
  registered = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  maplibregl.addProtocol(POLLING_PROTOCOL, async (params) => {
    // polling://{z}/{x}/{y}/{year}
    const [z, x, y, year] = params.url
      .replace(`${POLLING_PROTOCOL}://`, "")
      .split("/")
      .map(Number);

    const token = getToken();
    if (!url || !anon || !token) return { data: new Uint8Array(0) };

    const response = await fetch(`${url}/rest/v1/rpc/mvt_polling_points`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ z, x, y, p_year: year }),
    });

    if (!response.ok) return { data: new Uint8Array(0) };

    const payload = await response.json();
    // The function answers null below its minimum zoom and "" for an empty
    // tile; both mean "nothing here", which MapLibre expects as zero bytes.
    if (typeof payload !== "string" || payload.length === 0) {
      return { data: new Uint8Array(0) };
    }
    return { data: base64ToBytes(payload) };
  });
}
