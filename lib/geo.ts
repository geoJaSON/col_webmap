import type { Application } from "@/lib/types";

export type Bounds = [[number, number], [number, number]];

export function boundsOf(applications: Application[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const app of applications) {
    for (const ring of app.geometry.coordinates) {
      for (const [lon, lat] of ring) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }

  if (!Number.isFinite(west)) return null;
  return [
    [west, south],
    [east, north],
  ];
}

export function toFeatureCollection(applications: Application[]) {
  return {
    type: "FeatureCollection" as const,
    features: applications.map((app) => ({
      type: "Feature" as const,
      id: app.id,
      properties: {
        id: app.id,
        status: app.status,
        applicant: app.applicant,
        bay_system: app.bay_system,
        group_name: app.group_name,
        acreage: app.acreage,
      },
      geometry: app.geometry,
    })),
  };
}
