/**
 * Shared-passcode gate for the whole site.
 *
 * This keeps casual visitors out of a public Vercel URL. It is one shared
 * secret with no accounts behind it -- treat it as a door that is closed, not
 * as authentication.
 *
 * Edge-safe: middleware imports this, so it uses only Web Crypto and no Node
 * built-ins.
 */

export const ACCESS_COOKIE = "col_access";

/** Roughly six months -- long enough that nobody retypes it on a boat. */
export const ACCESS_MAX_AGE = 60 * 60 * 24 * 180;

/**
 * What goes in the cookie. Hashing means the shared passcode itself never sits
 * in a cookie jar, a proxy log, or a devtools panel.
 */
export async function accessToken(passcode: string): Promise<string> {
  const bytes = new TextEncoder().encode(`col-status:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
