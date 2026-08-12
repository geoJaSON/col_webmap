import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessToken } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const passcode = process.env.SITE_PASSCODE;
  const form = await request.formData();
  const entered = String(form.get("passcode") ?? "");

  const destination = request.nextUrl.clone();
  destination.search = "";

  if (!passcode || entered !== passcode) {
    destination.pathname = "/unlock";
    destination.search = "?wrong=1";
    // 303 so the browser follows with GET rather than re-POSTing.
    return NextResponse.redirect(destination, { status: 303 });
  }

  destination.pathname = "/";
  const response = NextResponse.redirect(destination, { status: 303 });
  response.cookies.set(ACCESS_COOKIE, await accessToken(passcode), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
  return response;
}
