"""Download RRC pipeline centerlines for the bay systems containing COLs.

Uses the public RRC service, including its bay tracts to limit coverage. No
credentials are needed. Run `npm run pipelines` to download and rebuild layers.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parent.parent
SERVICE = "https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer"
SOURCE_URL = "https://www.rrc.texas.gov/resource-center/research/gis-viewer/"
OUT = ROOT / "data" / "pipelines" / "rrc-pipelines.geojson"
# Keep adjacent shores too, so even the largest map buffer reaches the bay.
CLIP_PADDING_FEET = 2000
METERS_PER_FOOT = 0.3048
PROJECT = Transformer.from_crs(4326, 32614, always_xy=True).transform
UNPROJECT = Transformer.from_crs(32614, 4326, always_xy=True).transform


def query(layer: int, **params) -> dict:
    url = f"{SERVICE}/{layer}/query?{urlencode({'f': 'json', **params})}"
    with urlopen(url, timeout=90) as response:
        data = json.load(response)
    if "error" in data:
        raise RuntimeError(f"RRC layer {layer}: {data['error']}")
    return data


def object_ids(layer: int, **params) -> list[int]:
    data = query(layer, where="1=1", returnIdsOnly="true", **params)
    if "objectIds" not in data or data.get("exceededTransferLimit"):
        raise RuntimeError(f"RRC layer {layer} did not return a complete ID list")
    return sorted(set(data["objectIds"] or []))


def fetch_features(layer: int, ids: list[int], fields: str) -> list[dict]:
    features = []
    for start in range(0, len(ids), 200):
        batch = ids[start:start + 200]
        data = query(
            layer, f="geojson", objectIds=",".join(map(str, batch)),
            outFields=fields, returnGeometry="true", outSR=4326,
        )
        rows = data.get("features", [])
        received = [row["properties"]["OBJECTID"] for row in rows]
        if (data.get("exceededTransferLimit") or len(received) != len(batch)
                or set(received) != set(batch)):
            raise RuntimeError(f"Incomplete RRC layer {layer} batch at {start}; previous data retained")
        if any(not row.get("geometry") for row in rows):
            raise RuntimeError(f"Missing geometry in RRC layer {layer}")
        features.extend(rows)
        print(f"  Layer {layer}: {len(features)}/{len(ids)} features", flush=True)
    return features


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [line for part in geometry.geoms for line in line_parts(part)]
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--applications", type=Path, default=ROOT / "data" / "applications.json",
                        help="COL rows JSON or a current COL GeoJSON export")
    args = parser.parse_args()
    payload = json.loads(args.applications.read_text(encoding="utf-8-sig"))
    applications = payload["features"] if isinstance(payload, dict) else payload
    if not applications:
        raise ValueError("No COL applications supplied")
    properties = [app.get("properties", app) for app in applications]
    bay_systems = sorted({props.get("bay_system") or props["bay"] for props in properties})
    col_area = unary_union([transform(PROJECT, shape(app["geometry"])) for app in applications])

    print("Reading RRC bay tracts", flush=True)
    tracts = fetch_features(15, object_ids(15), "OBJECTID,BAY_NAME")
    tract_shapes = [(row["properties"]["BAY_NAME"], transform(PROJECT, shape(row["geometry"])))
                    for row in tracts]
    names = {bay.upper() for bay in bay_systems}
    if "Galveston Bay" in bay_systems:
        names.update({"EAST BAY", "WEST BAY", "TRINITY BAY"})
    # Include named sub-bays at the COLs, even when the workbook uses the larger
    # system's name. The COL polygons also close any gaps in the tract coverage.
    col_neighborhood = col_area.buffer(CLIP_PADDING_FEET * METERS_PER_FOOT)
    names.update(name for name, geom in tract_shapes if geom.intersects(col_neighborhood))
    missing = {bay.upper() for bay in bay_systems} - {name for name, _ in tract_shapes}
    if missing:
        raise ValueError(f"No RRC bay tracts for {sorted(missing)}")

    coverage = unary_union([geom for name, geom in tract_shapes if name in names] + [col_area])
    clip_area = coverage.buffer(CLIP_PADDING_FEET * METERS_PER_FOOT)
    # Query each disconnected bay region instead of one enormous coastal box.
    regions = list(clip_area.geoms) if hasattr(clip_area, "geoms") else [clip_area]
    pipeline_ids: set[int] = set()
    for region in regions:
        bounds = transform(UNPROJECT, region).bounds
        pipeline_ids.update(object_ids(
            13, geometry=",".join(map(str, bounds)), geometryType="esriGeometryEnvelope",
            inSR=4326, spatialRel="esriSpatialRelIntersects",
        ))
    if not pipeline_ids:
        raise RuntimeError("RRC returned no pipelines; previous data retained")
    print(f"Downloading {len(pipeline_ids)} candidate pipelines", flush=True)
    rows = fetch_features(13, sorted(pipeline_ids),
                          "OBJECTID,OPERATOR,SYSTEM_NAME,SUBSYSTEM_NAME,COMMODITY_DESCRIPTION,"
                          "DIAMETER,T4PERMIT,SYSTEM_TYPE,STATUS,COUNTY_NAME")
    features = []
    for row in rows:
        geom = shape(row["geometry"])
        if geom.geom_type not in {"LineString", "MultiLineString"} or not geom.is_valid:
            raise ValueError(f"Invalid pipeline geometry: {row['properties']['OBJECTID']}")
        parts = line_parts(transform(PROJECT, geom).intersection(clip_area))
        if not parts:
            continue
        clipped = parts[0] if len(parts) == 1 else MultiLineString(parts)
        props = row["properties"]
        row["properties"] = {
            "name": (props.get("SYSTEM_NAME") or props.get("OPERATOR") or "Pipeline").strip(),
            "rrc_id": props["OBJECTID"],
            "operator": props.get("OPERATOR"),
            "system": props.get("SYSTEM_NAME"),
            "subsystem": props.get("SUBSYSTEM_NAME"),
            "commodity": props.get("COMMODITY_DESCRIPTION"),
            "diameter_inches": props.get("DIAMETER"),
            "permit": props.get("T4PERMIT"),
            "system_type": props.get("SYSTEM_TYPE"),
            "status": props.get("STATUS"),
            "county": props.get("COUNTY_NAME"),
        }
        row["id"] = props["OBJECTID"]
        row["geometry"] = mapping(transform(UNPROJECT, clipped))
        features.append(row)
    if not features:
        raise RuntimeError("No pipelines intersect the bay coverage; previous data retained")

    result = {
        "type": "FeatureCollection",
        "metadata": {
            "sourceUrl": SOURCE_URL,
            "serviceUrl": f"{SERVICE}/13",
            "bayTractsUrl": f"{SERVICE}/15",
            "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "baySystems": bay_systems,
            "bayTracts": sorted(names),
            "clipPaddingFeet": CLIP_PADDING_FEET,
            "candidateFeatures": len(rows),
            "coverageDescription": "COL bay systems and adjacent shores. All reported pipeline statuses included.",
            "notice": "Approximate RRC locations; verify pipeline positions before site work.",
        },
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    temporary.replace(OUT)
    print(f"Wrote {len(features)} pipelines for {', '.join(bay_systems)} to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
