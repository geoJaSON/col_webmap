import { NextResponse, type NextRequest } from "next/server";

import { ApplicationNotFound, updateStatus } from "@/lib/store";
import { isStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: `"${rawId}" is not an application number.` }, { status: 400 });
  }

  // No check here: if SITE_PASSCODE is set, middleware has already turned away
  // anyone without the cookie, including on this route.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const status = (body as { status?: unknown } | null)?.status;
  if (!isStatus(status)) {
    return NextResponse.json(
      { error: "Status must be Accept, Modify, or Decline." },
      { status: 400 },
    );
  }

  try {
    const application = await updateStatus(id, status);
    return NextResponse.json({ application });
  } catch (error) {
    if (error instanceof ApplicationNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
