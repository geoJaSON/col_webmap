import { NextResponse, type NextRequest } from "next/server";

import type { Ring } from "@/lib/geometry";
import {
  ApplicationNotFound,
  GeometryRejected,
  updateGeometry,
  updateStatus,
} from "@/lib/store";
import { isStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** A ring is only usable if every entry is a finite [lon, lat] pair. */
function asRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null;
  const ring: Ring = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const [lon, lat] = point;
    if (typeof lon !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    ring.push([lon, lat]);
  }
  return ring;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: `"${rawId}" is not an application number.` }, { status: 400 });
  }

  // No passcode check here: if SITE_PASSCODE is set, middleware has already
  // turned away anyone without the cookie, including on this route.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    status?: unknown;
    geometry?: unknown;
    acreage?: unknown;
  };

  try {
    // Reshaping first: it also rewrites acreage, so a combined request must not
    // have a status write undo it.
    let application;

    if (payload.geometry !== undefined) {
      const polygon = payload.geometry as { type?: unknown; coordinates?: unknown };
      if (polygon?.type !== "Polygon" || !Array.isArray(polygon.coordinates)) {
        return NextResponse.json(
          { error: "Geometry must be a GeoJSON Polygon." },
          { status: 400 },
        );
      }
      const ring = asRing(polygon.coordinates[0]);
      if (!ring) {
        return NextResponse.json(
          { error: "Every corner must be a [longitude, latitude] pair." },
          { status: 400 },
        );
      }
      const acreage =
        typeof payload.acreage === "number" && Number.isFinite(payload.acreage)
          ? payload.acreage
          : undefined;
      application = await updateGeometry(id, ring, acreage);
    }

    if (payload.status !== undefined) {
      if (!isStatus(payload.status)) {
        return NextResponse.json(
          { error: "Status must be Accept, Modify, or Decline." },
          { status: 400 },
        );
      }
      application = await updateStatus(id, payload.status);
    }

    if (!application) {
      return NextResponse.json(
        { error: "Nothing to change — send a status or a geometry." },
        { status: 400 },
      );
    }

    return NextResponse.json({ application });
  } catch (error) {
    if (error instanceof ApplicationNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof GeometryRejected) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
