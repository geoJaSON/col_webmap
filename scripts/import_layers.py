"""
Convert reference shapefiles / GeoJSON into categorised web layers.

Scans the repo for shapefiles, reprojects to WGS84, strips Z, simplifies to
about a metre, and writes one GeoJSON *per category* into public/layers/ plus
an index.json the map reads at runtime.

Categories are the blocker types: everything in one shares a colour and a
buffer distance. They are declared in layers.config.json, so adding a layer is
a shapefile plus one line of config -- no code changes.

    python scripts/import_layers.py
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "layers.config.json"
OUT_DIR = ROOT / "public" / "layers"
INDEX = OUT_DIR / "index.json"
SKIP_DIRS = {"node_modules", ".next", ".git", "public", "data", "exports", "__pycache__", "supabase"}

# ~1.1 m. Lease boundaries are surveyed to far less precision than that, and
# thinning the vertices keeps the on-the-fly buffering responsive.
SIMPLIFY_DEGREES = 1e-5

SQ_M_PER_ACRE = 4046.8564224
EARTH_RADIUS_M = 6371007.2


def slugify(value: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", value.lower())).strip("-")


def count_vertices(geom) -> int:
    if geom is None or geom.is_empty:
        return 0
    if hasattr(geom, "geoms"):
        return sum(count_vertices(part) for part in geom.geoms)
    if geom.geom_type == "Polygon":
        return len(geom.exterior.coords) + sum(len(ring.coords) for ring in geom.interiors)
    return len(geom.coords)


def spherical_acres(geom) -> float:
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    total = 0.0
    for poly in polys:
        ring = list(poly.exterior.coords)
        acc = 0.0
        for i in range(len(ring) - 1):
            lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
            lon2, lat2 = math.radians(ring[i + 1][0]), math.radians(ring[i + 1][1])
            acc += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
        total += abs(acc * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)
    return total / SQ_M_PER_ACRE


def drop_z(geom):
    if geom is None or not geom.has_z:
        return geom
    import shapely.ops

    return shapely.ops.transform(lambda x, y, z=None: (x, y), geom)


def round_coords(node):
    """6 decimal places is ~11 cm -- finer than any permit boundary needs."""
    if isinstance(node, list):
        if node and isinstance(node[0], (int, float)):
            return [round(float(v), 6) for v in node]
        return [round_coords(v) for v in node]
    return node


def web_geometry(geometry):
    rounded = {**geometry, "coordinates": round_coords(geometry["coordinates"])}
    if geometry["type"] not in {"LineString", "MultiLineString"}:
        return rounded
    # Clipping a pipeline can leave very short components. Rounding both ends
    # to the same coordinate makes an invalid line; keep precision in that case.
    if shape(rounded).is_valid:
        return rounded
    if shape(geometry).is_valid:
        return geometry
    raise ValueError("Invalid reference geometry; repair the source before importing")


def find_sources() -> tuple[list[Path], list[str]]:
    sources: list[Path] = []
    problems: list[str] = []
    seen: set[Path] = set()

    for path in sorted(ROOT.rglob("*")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        suffix = path.suffix.lower()
        if suffix == ".geojson":
            sources.append(path)
            continue
        if suffix not in {".shp", ".shx"}:
            continue

        stem = path.with_suffix("")
        if stem in seen:
            continue
        seen.add(stem)

        # A shapefile is a file set. Without .shp there is no geometry at all,
        # and an orphan .shx is only an index into data nobody sent.
        missing = [e for e in (".shp", ".shx", ".dbf") if not stem.with_suffix(e).exists()]
        if missing:
            problems.append(
                f"{stem.relative_to(ROOT)}: incomplete shapefile, missing {', '.join(missing)}"
            )
            continue
        if not stem.with_suffix(".prj").exists():
            problems.append(f"{stem.relative_to(ROOT)}: no .prj, assuming WGS84 -- verify placement")
        sources.append(stem.with_suffix(".shp"))

    return sources, problems


def main() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    categories = config["categories"]
    mapping = config.get("layers", {})
    fallback = config.get("defaultCategory")
    name_fields = config.get("nameFields", [])

    sources, problems = find_sources()
    # Downloaded sources live under data/, which the shapefile scan excludes.
    for filename in config.get("sources", []):
        source = ROOT / filename
        if not source.is_file():
            raise FileNotFoundError(f"Missing {filename}; run npm run pipelines to download it")
        if source not in sources:
            sources.append(source)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    buckets: dict[str, list[dict]] = {key: [] for key in categories}
    contributors: dict[str, list[str]] = {key: [] for key in categories}
    metadata: dict[str, dict] = {key: {} for key in categories}

    for source in sources:
        label = source.stem
        slug = slugify(label)
        category = mapping.get(slug, fallback)
        if category not in categories:
            problems.append(f"{slug}: no category in layers.config.json -- skipped")
            continue

        frame = gpd.read_file(source)
        if frame.crs is None:
            frame = frame.set_crs("EPSG:4326")
        frame = frame.to_crs("EPSG:4326")
        frame["geometry"] = frame.geometry.map(drop_z)
        frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty].copy()
        allowed = {"Polygon", "MultiPolygon", "LineString", "MultiLineString"}
        if not frame.geometry.geom_type.isin(allowed).all():
            raise ValueError(f"{label}: reference layers must contain polygons or lines")
        before = int(frame.geometry.map(count_vertices).sum())
        frame["geometry"] = frame.geometry.simplify(SIMPLIFY_DEGREES, preserve_topology=True)
        after = int(frame.geometry.map(count_vertices).sum())

        field = next((f for f in name_fields if f in frame.columns), None)
        payload = json.loads(frame.to_json())
        if source.suffix.lower() == ".geojson":
            metadata[category].update(json.loads(source.read_text(encoding="utf-8")).get("metadata", {}))

        for feature, (_, row) in zip(payload["features"], frame.iterrows()):
            feature["geometry"] = web_geometry(feature["geometry"])
            name = str(row[field]) if field and row[field] is not None else label
            feature["properties"] = {
                **{key: feature["properties"].get(key) for key in categories[category].get("keepFields", [])},
                "name": name,
                "source": label,
                "category": category,
            }
            if row.geometry.geom_type in {"Polygon", "MultiPolygon"}:
                feature["properties"]["acres"] = round(spherical_acres(row.geometry), 2)
            buckets[category].append(feature)

        contributors[category].append(label)
        print(f"  {label}: {len(frame)} feature(s) -> {category} (vertices {before} -> {after})")

    entries = []
    for key, meta in categories.items():
        features = buckets[key]
        if not features:
            continue
        path = OUT_DIR / f"{key}.geojson"
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8"
        )

        lons: list[float] = []
        lats: list[float] = []

        def walk(node):
            if isinstance(node[0], (int, float)):
                lons.append(node[0])
                lats.append(node[1])
            else:
                for child in node:
                    walk(child)

        for feature in features:
            walk(feature["geometry"]["coordinates"])

        entries.append(
            {
                **metadata[key],
                "id": key,
                "label": meta["label"],
                "color": meta["color"],
                "bufferFeet": meta.get("bufferFeet", 0),
                "geometryType": meta.get("geometryType", "polygon"),
                "file": f"{key}.geojson",
                "features": len(features),
                "sources": contributors[key],
                "bounds": [
                    round(min(lons), 6),
                    round(min(lats), 6),
                    round(max(lons), 6),
                    round(max(lats), 6),
                ],
                "sizeKb": round(path.stat().st_size / 1024),
            }
        )
        print(f"  -> {key}.geojson: {len(features)} features, {entries[-1]['sizeKb']} KB")

    INDEX.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(f"\nwrote {len(entries)} categories to {OUT_DIR.relative_to(ROOT)}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print("  !", p)


if __name__ == "__main__":
    main()
