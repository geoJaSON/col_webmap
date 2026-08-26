import type { Application } from "@/lib/types";

/**
 * CSV of the COL areas, one row per application, laid out like the
 * `GIS Upload` sheet the data originally came from: the fixed fields first,
 * then `Latitude N` / `Longitude N` pairs across.
 *
 * The corner columns run out to the widest polygon in the exported set rather
 * than a fixed ten, so a filtered export does not trail empty columns.
 */

const FIXED = [
  "TPWD Application #",
  "Status",
  "Entity",
  "Owner",
  "Bay System",
  "Acreage",
  "Coordinate Count",
] as const;

/** Nearly every entity name contains a comma, so quoting is not optional. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Corners without the repeated closing point. */
function corners(application: Application): [number, number][] {
  const ring = application.geometry.coordinates[0] ?? [];
  return ring.slice(0, -1) as [number, number][];
}

export function applicationsToCsv(applications: Application[]): string {
  const sorted = [...applications].sort((a, b) => a.id - b.id);
  const widest = sorted.reduce((max, app) => Math.max(max, corners(app).length), 0);

  const header: string[] = [...FIXED];
  for (let i = 1; i <= widest; i++) header.push(`Latitude ${i}`, `Longitude ${i}`);

  const rows = sorted.map((app) => {
    const ring = corners(app);
    const row: string[] = [
      cell(app.id),
      cell(app.status),
      cell(app.applicant),
      cell(app.group_name),
      cell(app.bay_system),
      cell(app.acreage === null ? "" : app.acreage.toFixed(2)),
      cell(ring.length),
    ];
    for (let i = 0; i < widest; i++) {
      const point = ring[i];
      // Six decimals is ~11 cm and matches what the app stores and displays.
      row.push(point ? cell(point[1].toFixed(6)) : "", point ? cell(point[0].toFixed(6)) : "");
    }
    return row.join(",");
  });

  // CRLF and a BOM: what Excel on Windows expects to open cleanly.
  return "\uFEFF" + [header.map(cell).join(","), ...rows].join("\r\n") + "\r\n";
}
