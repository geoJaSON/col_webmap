import { NextResponse } from "next/server";

import { listApplications, storeMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const applications = await listApplications();
    return NextResponse.json({ applications, mode: storeMode() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
