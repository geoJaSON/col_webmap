"""Clip ESI shoreline segments to within 3,000 feet of the COL polygons.

Run `npm run shorelines` after dropping the source GeoPackage in the repo.
Use --applications with a current GeoJSON export to include saved COL edits.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
import pyogrio
from pyproj import CRS, Transformer
from shapely.geometry import LineString, MultiLineString, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "shorelines" / "esi-shorelines.geojson"
CLIP_FEET = 3000
METERS_PER_FOOT = 0.3048
SIMPLIFY_METERS = 1
FIELDS = {
    "ESI": "esi",
    "MOST_SENSITIVE": "most_sensitive",
    "LANDWARD_SHORETYPE": "landward_shoretype",
    "SEAWARD_SHORETYPE1": "seaward_shoretype1",
    "SEAWARD_SHORETYPE2": "seaward_shoretype2",
    "GENERALIZED_ESI_TYPE": "shoreline_type",
    "SOURCE_ID": "source_id",
    "ESI_SOURCE": "esi_source",
}


def clip_region(applications: list[dict]):
    if not applications:
        raise ValueError("No COL applications supplied")
    polygons = [shape(app["geometry"]) for app in applications]
    if any(p.is_empty or not p.is_valid or p.geom_type not in {"Polygon", "MultiPolygon"}
           for p in polygons):
        raise ValueError("COL applications must contain valid polygons")
    west, south, east, north = unary_union(polygons).bounds
    # Web Mercator distances are distorted at the COLs' latitude. A local
    # azimuthal equidistant projection keeps this coastal extent in metres.
    crs = CRS.from_proj4(
        f"+proj=aeqd +lat_0={(south + north) / 2} +lon_0={(west + east) / 2} "
        "+datum=WGS84 +units=m +no_defs"
    )
    project = Transformer.from_crs(4326, crs, always_xy=True).transform
    area = unary_union([transform(project, p) for p in polygons])
    return crs, area.buffer(CLIP_FEET * METERS_PER_FOOT, quad_segs=64)


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [line for part in geometry.geoms for line in line_parts(part)]
    # A shoreline touching only the clipping boundary contributes no length.
    return []


def clip_line(geometry, region):
    if not geometry.is_valid or geometry.geom_type not in {"LineString", "MultiLineString"}:
        raise ValueError("Shorelines must contain valid line geometries")
    # Simplify before clipping so shortcuts cannot extend beyond the mask.
    parts = line_parts(geometry.simplify(SIMPLIFY_METERS).intersection(region))
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiLineString(parts)


def build_snapshot(source: Path, applications: list[dict], layer: str) -> dict:
    crs, region = clip_region(applications)
    info = pyogrio.read_info(source, layer=layer)
    if not info["crs"]:
        raise ValueError("The shoreline source must declare its coordinate system")
    # Use the GeoPackage spatial index to read nearby candidates, then clip
    # against the actual buffered polygons rather than their bounding boxes.
    bbox = Transformer.from_crs(crs, info["crs"], always_xy=True).transform_bounds(*region.bounds)
    frame = gpd.read_file(source, layer=layer, bbox=bbox, engine="pyogrio", fid_as_index=True)
    missing = set(FIELDS) - set(frame.columns)
    if missing:
        raise ValueError(f"Missing ESI shoreline fields: {sorted(missing)}")
    frame = frame.to_crs(crs)
    unproject = Transformer.from_crs(crs, 4326, always_xy=True).transform
    # Convert pandas missing values and numpy scalar types to JSON once.
    attributes = json.loads(frame[list(FIELDS)].to_json(orient="records"))
    features = []
    for (source_id, row), properties in zip(frame.iterrows(), attributes):
        if row.geometry is None or row.geometry.is_empty:
            raise ValueError(f"Missing shoreline geometry: {source_id}")
        clipped = clip_line(row.geometry, region)
        if clipped is None:
            continue
        features.append({
            "type": "Feature",
            "id": int(source_id),
            "properties": {
                "shoreline_id": int(source_id),
                "name": properties["GENERALIZED_ESI_TYPE"] or "Shoreline",
                **{target: properties[field] for field, target in FIELDS.items()},
            },
            "geometry": mapping(transform(unproject, clipped)),
        })
    if not features:
        raise ValueError("No shoreline segments within 3,000 ft of the supplied COLs; previous data retained")
    return {
        "type": "FeatureCollection",
        "metadata": {
            "sourceFile": source.name,
            "sourceLayer": layer,
            "sourceFeatures": int(info["features"]),
            "clipPaddingFeet": CLIP_FEET,
            "applicationCount": len(applications),
            "clipCrs": crs.to_string(),
            "simplifyMeters": SIMPLIFY_METERS,
            "coverageDescription": "ESI 2024 shoreline segments within 3,000 ft of the COL polygons.",
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="ESI shoreline GeoPackage (auto-detected by default)")
    parser.add_argument("--layer", default="ESI_Shoreline")
    parser.add_argument("--applications", type=Path, default=ROOT / "data" / "applications.json",
                        help="COL rows JSON or a current COL GeoJSON export (WGS84)")
    args = parser.parse_args()
    source = args.source
    if source is None:
        candidates = sorted(ROOT.glob("Environmental_Sensitivity_Index_Shoreline*.gpkg"))
        if len(candidates) != 1:
            parser.error("Supply --source or place exactly one ESI shoreline GeoPackage in the repo root")
        source = candidates[0]
    payload = json.loads(args.applications.read_text(encoding="utf-8-sig"))
    applications = payload["features"] if isinstance(payload, dict) else payload
    result = build_snapshot(source, applications, args.layer)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    temporary.replace(OUT)
    print(f"Clipped {len(result['features'])} of {result['metadata']['sourceFeatures']} shorelines "
          f"to within {CLIP_FEET:,} ft of {len(applications)} COLs -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
