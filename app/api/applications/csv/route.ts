import { NextResponse, type NextRequest } from "next/server";

import { applicationsToCsv } from "@/lib/csv";
import { listApplications } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * COL areas as CSV, one row per application with its corner coordinates.
 *
 * An optional `ids` query (comma separated) narrows the export to whatever the
 * panel is currently showing, so what you filtered is what you get.
 *
 * Routing note: this static segment wins over the sibling `[id]` route, so
 * `/api/applications/csv` never reaches the PATCH handler.
 */
export async function GET(request: NextRequest) {
  try {
    const applications = await listApplications();

    const raw = request.nextUrl.searchParams.get("ids");
    let selected = applications;
    if (raw) {
      const wanted = new Set(
        raw
          .split(",")
          .map((value) => Number(value.trim()))
          .filter(Number.isInteger),
      );
      if (wanted.size > 0) selected = applications.filter((a) => wanted.has(a.id));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = raw ? `-${selected.length}-of-${applications.length}` : "";

    return new NextResponse(applicationsToCsv(selected), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="col-areas-${stamp}${suffix}.csv"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
