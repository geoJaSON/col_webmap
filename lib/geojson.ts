import type { Application } from "@/lib/types";

/**
 * GeoJSON shaped for ArcGIS Pro / ArcGIS Online.
 *
 * Choices made for Esri specifically:
 *  - WGS84 lon/lat, which is what RFC 7946 mandates and what ArcGIS assumes.
 *  - A legacy `crs` member. RFC 7946 dropped it, but several Esri and FME
 *    import paths still look for it and it is ignored by everything modern.
 *  - Short, plain property names. Exporting to a shapefile truncates field
 *    names at 10 characters, so they are kept under that and free of spaces
 *    and punctuation to survive the round trip.
 *  - Rings are already closed and wound counter-clockwise by the extractor.
 */
export function toEsriGeoJSON(applications: Application[]) {
  return {
    type: "FeatureCollection" as const,
    name: "COL_Applications",
    crs: {
      type: "name" as const,
      properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
    },
    features: applications
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((app) => ({
        type: "Feature" as const,
        properties: {
          app_no: app.id,
          status: app.status,
          // "Entity" in the UI; the workbook's Applicant Name.
          entity: app.applicant,
          // "Owner" in the UI; the workbook's Group -- Justin or Johny.
          owner: app.group_name,
          bay: app.bay_system,
          acres: app.acreage,
        },
        geometry: app.geometry,
      })),
  };
}
