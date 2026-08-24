"""
Convert reference shapefiles / GeoJSON into web layers.

Scans the repo for shapefiles, reprojects everything to WGS84, strips Z, and
writes one GeoJSON per layer into public/layers/ plus an index.json the app
reads at runtime. Drop a new folder of shapefiles anywhere in the repo and
re-run; nothing else needs editing.

    python scripts/import_layers.py
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "layers"
INDEX = OUT_DIR / "index.json"
SKIP_DIRS = {"node_modules", ".next", ".git", "public", "data", "__pycache__"}

# Distinct from the status triad (green/amber/red) and the magenta used for
# selection and editing, so a reference layer can never be mistaken for a lease.
PALETTE = ["#4db6d0", "#a78bd0", "#6c8ebf", "#4fb3a5", "#8fa3ad", "#c98fb0"]

SQ_M_PER_ACRE = 4046.8564224
EARTH_RADIUS_M = 6371007.2


def slugify(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def spherical_acres(geom) -> float | None:
    """Same spherical-excess method the app uses for lease acreage."""
    polygons = []
    if geom.geom_type == "Polygon":
        polygons = [geom]
    elif geom.geom_type == "MultiPolygon":
        polygons = list(geom.geoms)
    else:
        return None

    total = 0.0
    for poly in polygons:
        ring = list(poly.exterior.coords)
        acc = 0.0
        for i in range(len(ring) - 1):
            lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
            lon2, lat2 = math.radians(ring[i + 1][0]), math.radians(ring[i + 1][1])
            acc += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
        total += abs(acc * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)
    return total / SQ_M_PER_ACRE


def drop_z(geom):
    """GeoJSON here is 2D; a stray Z just bloats the file and confuses readers."""
    if geom is None or not geom.has_z:
        return geom
    import shapely.ops

    return shapely.ops.transform(lambda x, y, z=None: (x, y), geom)


def find_sources() -> tuple[list[Path], list[str]]:
    """Shapefiles worth importing, plus complaints about incomplete sets."""
    sources: list[Path] = []
    problems: list[str] = []
    seen_stems: set[Path] = set()

    for path in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in {".shp", ".shx", ".geojson", ".json"}:
            continue
        if path.suffix.lower() in {".geojson"}:
            sources.append(path)
            continue
        if path.suffix.lower() == ".json":
            continue

        stem = path.with_suffix("")
        if stem in seen_stems:
            continue
        seen_stems.add(stem)

        # A shapefile is really a file set. Without .shp there is no geometry
        # at all, and without .dbf there are no attributes -- an orphan .shx is
        # just an index into data nobody sent.
        missing = [ext for ext in (".shp", ".shx", ".dbf") if not stem.with_suffix(ext).exists()]
        if missing:
            problems.append(
                f"{stem.relative_to(ROOT)}: incomplete shapefile, missing {', '.join(missing)}"
            )
            continue
        if not stem.with_suffix(".prj").exists():
            problems.append(
                f"{stem.relative_to(ROOT)}: no .prj, assuming WGS84 -- verify the placement"
            )
        sources.append(stem.with_suffix(".shp"))

    return sorted(sources), problems


def main() -> None:
    sources, problems = find_sources()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    entries = []
    for i, source in enumerate(sources):
        frame = gpd.read_file(source)
        if frame.crs is None:
            frame = frame.set_crs("EPSG:4326")
        frame = frame.to_crs("EPSG:4326")
        frame["geometry"] = frame.geometry.map(drop_z)

        label = source.stem
        slug = slugify(label)
        payload = json.loads(frame.to_json())
        payload["name"] = label

        # 6 decimal places is ~11 cm -- far finer than a permit boundary needs.
        def round_coords(node):
            if isinstance(node, list):
                if node and isinstance(node[0], (int, float)):
                    return [round(float(v), 6) for v in node]
                return [round_coords(v) for v in node]
            return node

        for feature in payload["features"]:
            feature["geometry"]["coordinates"] = round_coords(
                feature["geometry"]["coordinates"]
            )

        (OUT_DIR / f"{slug}.geojson").write_text(json.dumps(payload), encoding="utf-8")

        acres = sum(a for a in (spherical_acres(g) for g in frame.geometry) if a) or None
        bounds = [round(float(v), 6) for v in frame.total_bounds]
        entries.append(
            {
                "id": slug,
                "label": label,
                "file": f"{slug}.geojson",
                "geometryType": frame.geometry.geom_type.mode().iloc[0],
                "features": int(len(frame)),
                "bounds": bounds,
                "acres": round(acres, 2) if acres else None,
                "color": PALETTE[i % len(PALETTE)],
            }
        )
        print(f"  {slug}.geojson  {len(frame)} feature(s)"
              + (f", {acres:.2f} ac" if acres else ""))

    INDEX.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(f"\nwrote {len(entries)} layer(s) to {OUT_DIR.relative_to(ROOT)}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print("  !", p)


if __name__ == "__main__":
    main()
