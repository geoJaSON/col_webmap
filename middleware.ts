import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * The front door.
 *
 * Every page and every API route requires a signed-in Supabase user. This
 * replaced a shared site passcode: one login now covers the map, the polling
 * layer, and recording ground samples, instead of a passcode followed by a
 * second sign-in hidden in the Layers panel.
 *
 * ---------------------------------------------------------------------------
 * WHO THIS LETS IN — read before changing it
 *
 * The gate is "has a session in this Supabase project", nothing finer. That is
 * safe *today* because the project is the CV Carbon platform and `auth.users`
 * holds staff accounts only; lessees and other clients authenticate through
 * AGOL, not through Supabase. So "authenticated" and "our team" are currently
 * the same set of people.
 *
 * If client accounts are ever added to this project, that stops being true and
 * this check silently widens to include them. The fix at that point is an
 * allowlist — a table of who may see COL data, checked here — not a change
 * anywhere else. This is the only place the decision lives, deliberately.
 * ---------------------------------------------------------------------------
 */

/** Reachable signed out, or there would be no way to sign in. */
const OPEN_PATHS = new Set(["/login"]);

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without keys nobody could ever sign in, and gating would lock the site to
  // everyone including whoever is trying to fix it. Fail open and let the
  // login page explain what is missing.
  if (!url || !key) return NextResponse.next();

  // This response is what carries refreshed auth cookies back to the browser,
  // so it has to be the object we ultimately return on the success path.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: this revalidates the token with Supabase rather
  // than trusting a cookie the browser could have forged, and it is what
  // refreshes an expired access token. Do not "optimise" it to getSession.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Someone already signed in has no business on the login page.
  if (OPEN_PATHS.has(pathname)) {
    if (user) {
      const map = request.nextUrl.clone();
      map.pathname = "/";
      map.search = "";
      return NextResponse.redirect(map);
    }
    return response;
  }

  if (user) return response;

  // Fetches from the page should fail as JSON, not as a redirect to HTML the
  // caller cannot parse.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to use this." }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  // Where they were headed, so signing in lands them there rather than dumping
  // everyone on the map root.
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Auth cookies must be refreshed on ordinary navigations too, so this stays
  // broad and only skips things that are never gated.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
