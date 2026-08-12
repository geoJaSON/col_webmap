import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, accessToken } from "@/lib/access";

/** Reachable without the passcode, or there would be no way to enter it. */
const OPEN_PATHS = new Set(["/unlock", "/api/unlock"]);

export async function middleware(request: NextRequest) {
  const passcode = process.env.SITE_PASSCODE;
  // No passcode configured means the site is open, which is the default.
  if (!passcode) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();

  if (request.cookies.get(ACCESS_COOKIE)?.value === (await accessToken(passcode))) {
    return NextResponse.next();
  }

  // Fetches from the page should fail as JSON, not as a redirect to HTML the
  // caller cannot parse.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "This site is locked." }, { status: 401 });
  }

  const unlock = request.nextUrl.clone();
  unlock.pathname = "/unlock";
  unlock.search = "";
  return NextResponse.redirect(unlock);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
