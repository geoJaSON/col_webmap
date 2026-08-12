import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Tells the browser whether a passcode will be demanded on save, without
 * revealing the passcode itself.
 */
export async function GET() {
  return NextResponse.json({ passcodeRequired: Boolean(process.env.EDIT_PASSCODE) });
}
