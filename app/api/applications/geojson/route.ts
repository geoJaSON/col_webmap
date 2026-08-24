import { NextResponse } from "next/server";

import { toEsriGeoJSON } from "@/lib/geojson";
import { listApplications } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Current application areas as a downloadable GeoJSON.
 *
 * This is a live export rather than a checked-in file: statuses change in the
 * app, so a snapshot on disk goes stale the moment someone presses Decline.
 *
 * Note for routing: this static segment wins over the sibling `[id]` route, so
 * `/api/applications/geojson` never reaches the PATCH handler.
 */
export async function GET() {
  try {
    const applications = await listApplications();
    return NextResponse.json(toEsriGeoJSON(applications), {
      headers: {
        "Content-Type": "application/geo+json",
        "Content-Disposition": 'attachment; filename="col_applications.geojson"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
