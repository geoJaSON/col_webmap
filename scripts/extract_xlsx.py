"""
Convert Justin_Johny_COL_Status.xlsx -> data/applications.json + supabase/seed.sql

The workbook stores each polygon vertex as a pair of `Latitude N` / `Longitude N`
columns (N = 1..10) in the order TPWD supplied them. This flattens that wide
layout into GeoJSON-style ring coordinates ([lon, lat], first vertex repeated
to close the ring) and emits both a JSON seed for the app and idempotent SQL
for Supabase.

Only the `GIS Upload` sheet is read -- the `Justin` and `Johny` tabs are
group-filtered copies of the same rows.
"""

from __future__ import annotations

import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "Justin_Johny_COL_Status.xlsx"
JSON_OUT = ROOT / "data" / "applications.json"
SQL_OUT = ROOT / "supabase" / "seed.sql"

MAX_VERTICES = 10
VALID_STATUS = {"Accept", "Modify", "Decline"}


def signed_area(ring: list[list[float]]) -> float:
    """Shoelace on [lon, lat] pairs. Positive = counter-clockwise."""
    total = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def segments_cross(a1, a2, b1, b2) -> bool:
    """Proper segment intersection test (shared endpoints don't count)."""

    def orient(p, q, r):
        v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
        if abs(v) < 1e-12:
            return 0
        return 1 if v > 0 else 2

    o1, o2 = orient(a1, a2, b1), orient(a1, a2, b2)
    o3, o4 = orient(b1, b2, a1), orient(b1, b2, a2)
    return o1 != o2 and o3 != o4


def self_intersects(ring: list[list[float]]) -> bool:
    edges = [(ring[i], ring[i + 1]) for i in range(len(ring) - 1)]
    n = len(edges)
    for i in range(n):
        for j in range(i + 1, n):
            # skip adjacent edges (and the wrap-around pair) -- they share a vertex
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            if segments_cross(*edges[i], *edges[j]):
                return True
    return False


def slugify(value: str) -> str:
    return "".join(c.lower() if c.isalnum() else "-" for c in value).strip("-")


def main() -> None:
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    rows = list(wb["GIS Upload"].iter_rows(values_only=True))
    header = list(rows[0])

    records = []
    problems = []
    notes = []

    for raw in rows[1:]:
        row = dict(zip(header, raw))
        app_no = row.get("TPWD Application #")
        if app_no is None:
            continue

        ring: list[list[float]] = []
        for i in range(1, MAX_VERTICES + 1):
            lat = row.get(f"Latitude {i}")
            lon = row.get(f"Longitude {i}")
            if lat is None or lon is None:
                continue
            ring.append([float(lon), float(lat)])

        declared = row.get("Coordinate Count")
        if declared is not None and int(declared) != len(ring):
            problems.append(
                f"app {app_no}: Coordinate Count says {declared} but found {len(ring)} vertices"
            )

        # A few source rows repeat a vertex (app 107 lists vertex 3 twice). The
        # zero-length edge that creates makes the ring degenerate, so drop
        # consecutive duplicates before anything downstream sees the geometry.
        deduped = [ring[0]]
        for point in ring[1:]:
            if point != deduped[-1]:
                deduped.append(point)
        if len(deduped) != len(ring):
            notes.append(
                f"app {app_no}: dropped {len(ring) - len(deduped)} duplicate vertex/vertices"
            )
        ring = deduped

        if len(ring) < 3:
            problems.append(f"app {app_no}: only {len(ring)} vertices -- cannot form a polygon")
            continue

        status = row.get("Status")
        if status not in VALID_STATUS:
            problems.append(f"app {app_no}: unexpected status {status!r}")

        closed = ring + [ring[0]]
        # GeoJSON RFC 7946 wants exterior rings counter-clockwise.
        if signed_area(closed) < 0:
            closed = list(reversed(closed))
        if self_intersects(closed):
            problems.append(f"app {app_no}: ring self-intersects (bowtie) -- renders oddly")

        # Shaped exactly like a row of public.col_applications, so the offline
        # seed and the database return identical objects to the app.
        records.append(
            {
                "id": int(app_no),
                "group_name": row.get("Group"),
                "status": status,
                "applicant": row.get("Applicant Name"),
                "bay_system": row.get("Bay System"),
                "acreage": float(row["Acreage"]) if row.get("Acreage") is not None else None,
                "geometry": {"type": "Polygon", "coordinates": [closed]},
            }
        )

    records.sort(key=lambda r: r["id"])

    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    SQL_OUT.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(json.dumps(records, indent=2), encoding="utf-8")

    lines = [
        "-- Generated by scripts/extract_xlsx.py -- do not edit by hand.",
        "-- Re-runnable: existing rows keep their current status, everything else is refreshed.",
        "",
    ]
    for r in records:
        geom = json.dumps(r["geometry"]).replace("'", "''")
        applicant = r["applicant"].replace("'", "''")
        lines.append(
            "insert into public.col_applications "
            "(id, group_name, status, applicant, bay_system, acreage, geometry) values "
            f"({r['id']}, '{r['group_name']}', '{r['status']}', '{applicant}', "
            f"'{r['bay_system']}', {r['acreage']}, '{geom}'::jsonb)"
            "\n  on conflict (id) do update set"
            "\n    group_name = excluded.group_name,"
            "\n    applicant  = excluded.applicant,"
            "\n    bay_system = excluded.bay_system,"
            "\n    acreage    = excluded.acreage,"
            "\n    geometry   = excluded.geometry;"
        )
    SQL_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"wrote {len(records)} records")
    print(f"  {JSON_OUT.relative_to(ROOT)}")
    print(f"  {SQL_OUT.relative_to(ROOT)}")
    owners = sorted({r["applicant"] for r in records})
    print(f"owners: {len(owners)}, bays: {sorted({r['bay_system'] for r in records})}")
    if notes:
        print(f"\n{len(notes)} cleanup(s) applied:")
        for n in notes:
            print("  ~", n)
    if problems:
        print(f"\n{len(problems)} data issue(s):")
        for p in problems:
            print("  !", p)
    else:
        print("\nno geometry or status issues found")


if __name__ == "__main__":
    main()
