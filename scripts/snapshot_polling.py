"""Export a static, spatially partitioned polling layer without database changes.

Read-only PostgREST requests use this project's server credentials from .env.
Includes unarchived unleased points in COL bays, plus every unarchived point
inside the current saved COL polygons. All polling years are retained.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import dotenv_values
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.prepared import prep

from fetch_pipelines import fetch_features, object_ids

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "polling"
CHUNK_ZOOM = 14
PAGE_SIZE = 1000
FIELDS = "id,geom,substrate,lease_number,poll_year"


class Database:
    def __init__(self):
        config = {**dotenv_values(ROOT / ".env"), **dotenv_values(ROOT / ".env.local"), **os.environ}
        self.url = config.get("SUPABASE_URL", "").rstrip("/")
        key = config.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not self.url or not key:
            raise ValueError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def rows(self, table: str, params: dict) -> list[dict]:
        """Keyset pagination; reject truncated or changing exports before publishing."""
        result = []
        last_id = None
        expected = None
        while True:
            query = {**params, "order": "id.asc", "limit": PAGE_SIZE}
            if last_id is not None:
                query["id"] = f"gt.{last_id}"
            headers = {**self.headers, **({"Prefer": "count=exact"} if expected is None else {})}
            request = Request(f"{self.url}/rest/v1/{table}?{urlencode(query)}", headers=headers)
            with urlopen(request, timeout=45) as response:
                page = json.load(response)
                if expected is None:
                    total = response.headers.get("Content-Range", "").rsplit("/", 1)[-1]
                    if not total.isdigit():
                        raise ValueError(f"{table}: API did not return an exact count")
                    expected = int(total)
            if not isinstance(page, list):
                raise ValueError(f"{table}: invalid response")
            ids = [row["id"] for row in page]
            if ids != sorted(set(ids)) or (ids and last_id is not None and ids[0] <= last_id):
                raise ValueError(f"{table}: pagination did not advance")
            result.extend(page)
            if len(result) >= expected or not page:
                break
            last_id = ids[-1]
        if len(result) != expected:
            raise ValueError(f"{table}: expected {expected} rows, received {len(result)}; rerun export")
        return result


def envelope(bounds) -> str:
    west, south, east, north = bounds
    return f"ov.SRID=4326;POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"


def chunk_for(lon: float, lat: float, zoom: int = CHUNK_ZOOM) -> tuple[int, int]:
    n = 2 ** zoom
    return (math.floor((lon + 180) / 360 * n),
            math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def selected_point(row, bay_area, col_area) -> bool:
    point = shape(row["geom"])
    if point.geom_type != "Point" or point.is_empty or not point.is_valid:
        raise ValueError(f"Invalid polling geometry: {row['id']}")
    return col_area.covers(point) or (row["lease_number"] is None and bay_area.covers(point))


def main():
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db = Database()
    applications = db.rows("col_applications", {"select": "id,bay_system,geometry"})
    if not applications:
        raise ValueError("No current COL polygons returned; snapshot unchanged")
    col_shapes = [shape(app["geometry"]) for app in applications]
    if any(not geom.is_valid or geom.is_empty for geom in col_shapes):
        raise ValueError("Invalid COL boundary; snapshot unchanged")
    col_union = unary_union(col_shapes)
    col_area = prep(col_union)
    bay_systems = sorted({app["bay_system"] for app in applications})
    names = {name.upper() for name in bay_systems}
    if "Galveston Bay" in bay_systems:
        names.update({"EAST BAY", "WEST BAY", "TRINITY BAY"})
    print("Reading bay boundaries", flush=True)
    tracts = fetch_features(15, object_ids(15), "OBJECTID,BAY_NAME")
    tract_shapes = [(row["properties"]["BAY_NAME"], shape(row["geometry"])) for row in tracts]
    names.update(name for name, geom in tract_shapes if col_area.intersects(geom))
    if names - {name for name, _ in tract_shapes}:
        raise ValueError("A COL bay system has no matching RRC bay tracts")
    bays = unary_union([geom for name, geom in tract_shapes if name in names])
    bay_area = prep(bays)

    print("Reading unleased polling points across the COL bays (all unarchived years)", flush=True)
    # Include the COL bounds too, so an unleased point in a gap between bay
    # tracts is still captured when it falls within an application polygon.
    bounds = unary_union([bays, col_union]).bounds
    candidates = db.rows("gis_polling_points", {
        "select": FIELDS, "archive": "eq.false", "lease_number": "is.null", "geom": envelope(bounds),
    })
    selected = {row["id"]: row for row in candidates if selected_point(row, bay_area, col_area)}
    print(f"Selected {len(selected)} unleased points from {len(candidates)} candidates", flush=True)

    def read_col(item):
        app, geom = item
        rows = db.rows("gis_polling_points", {
            "select": FIELDS, "archive": "eq.false", "lease_number": "not.is.null",
            "geom": envelope(geom.bounds),
        })
        return app["id"], [row for row in rows if geom.covers(shape(row["geom"]))]

    print("Reading lease-attributed polling points inside COL polygons", flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, (app_id, rows) in enumerate(pool.map(read_col, zip(applications, col_shapes)), 1):
            for row in rows:
                if not selected_point(row, bay_area, col_area):
                    raise ValueError(f"Point outside snapshot scope: {row['id']}")
                selected[row["id"]] = row
            if i % 10 == 0 or i == len(applications):
                print(f"  Checked {i}/{len(applications)} COLs", flush=True)
    if not selected:
        raise ValueError("No polling points selected; snapshot unchanged")

    publish_snapshot(selected, applications, bays, started, bay_systems, names)


def publish_snapshot(selected, applications, bays, started, bay_systems, names):
    col_area = prep(unary_union([shape(app["geometry"]) for app in applications]))
    # Pin the source boundaries as well as the points in the content identity.
    coverage = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": bays.__geo_interface__, "properties": {"kind": "bays"}},
        *[{"type": "Feature", "geometry": app["geometry"], "properties": {"kind": "col", "id": app["id"]}} for app in applications],
    ]}
    chunks = defaultdict(list)
    years = Counter()
    unleased = 0
    in_col = 0
    digest = hashlib.sha256(json.dumps({"chunkZoom": CHUNK_ZOOM, "coverage": coverage}, separators=(",", ":")).encode())
    coords = []
    for row in sorted(selected.values(), key=lambda row: row["id"]):
        lon, lat = row["geom"]["coordinates"][:2]
        coords.append((lon, lat))
        years[str(row["poll_year"])] += 1
        unleased += row["lease_number"] is None
        in_col += col_area.covers(shape(row["geom"]))
        feature = {
            "type": "Feature", "id": row["id"],
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"substrate": row["substrate"], "lease_number": row["lease_number"], "poll_year": row["poll_year"]},
        }
        digest.update(json.dumps(feature, separators=(",", ":"), allow_nan=False).encode())
        chunks[chunk_for(lon, lat)].append(feature)

    snapshot_id = digest.hexdigest()[:16]
    directory = OUTPUT / snapshot_id
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    total_bytes = 0
    for (x, y), features in sorted(chunks.items()):
        payload = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"), allow_nan=False)
        path = directory / f"{x}-{y}.geojson"
        if path.exists() and path.read_text(encoding="utf-8") != payload:
            raise ValueError("Snapshot content hash collision; snapshot unchanged")
        path.write_text(payload, encoding="utf-8")
        size = path.stat().st_size
        total_bytes += size
        entries.append({"x": x, "y": y, "features": len(features), "bytes": size})

    metadata = {
        "version": 1, "snapshotId": snapshot_id,
        "startedAt": started, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "CV Carbon polling data", "bayBoundarySource": "Texas RRC bay tracts",
        "baySystems": bay_systems, "bayTracts": sorted(names),
        "scope": "Unleased points across the COL bays, plus all points inside COL polygons.",
        "archiveFilter": "archive = false", "years": dict(sorted(years.items())),
        "features": len(selected), "unleasedFeatures": unleased, "colFeatures": in_col,
        "leasedColFeatures": len(selected) - unleased,
        "colIds": sorted(app["id"] for app in applications),
        "bounds": [min(p[0] for p in coords), min(p[1] for p in coords), max(p[0] for p in coords), max(p[1] for p in coords)],
        "chunkZoom": CHUNK_ZOOM, "minZoom": 14, "chunks": entries, "bytes": total_bytes,
    }
    # Keep the exact boundaries with the snapshot so its scope remains auditable
    # after a COL shape is edited. These are never used to change database access.
    (directory / "coverage.geojson").write_text(json.dumps(coverage, separators=(",", ":")), encoding="utf-8")
    temporary = OUTPUT / "index.tmp"
    temporary.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    temporary.replace(OUTPUT / "index.json")
    print(f"Published {len(selected):,} points in {len(chunks)} chunks ({total_bytes / 1024 / 1024:.1f} MB total)")
    print(f"Unleased: {unleased:,}; inside COLs: {in_col:,}; lease-attributed inside COLs: {len(selected) - unleased:,}")


if __name__ == "__main__":
    main()
