"""Check shoreline distance clipping and the generated map layer."""
import json
import unittest

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, box, mapping, shape
from shapely.ops import transform

from clip_shorelines import ROOT, clip_line, clip_region


class ShorelineTests(unittest.TestCase):
    def test_clips_crossing_lines_instead_of_retaining_whole_features(self):
        # Neither endpoint is inside: selecting by endpoints would lose this.
        clipped = clip_line(LineString([(-20, 5), (20, 5)]), box(0, 0, 10, 10))
        self.assertTrue(clipped.equals(LineString([(0, 5), (10, 5)])))
        self.assertIsNone(clip_line(LineString([(-20, 15), (20, 15)]), box(0, 0, 10, 10)))

    def test_multipart_and_point_contacts(self):
        lines = MultiLineString([
            [(-20, 2), (20, 2)], [(-20, 8), (20, 8)], [(-1, -1), (0, 0)],
        ])
        clipped = clip_line(lines, box(0, 0, 10, 10))
        self.assertEqual(clipped.geom_type, "MultiLineString")
        self.assertEqual(len(clipped.geoms), 2)
        self.assertAlmostEqual(clipped.length, 20)
        self.assertIsNone(clip_line(LineString([(-1, -1), (0, 0)]), box(0, 0, 10, 10)))

    def test_radius_is_3000_feet_and_col_interior_is_included(self):
        polygon = box(-96.01, 28.99, -95.99, 29.01)
        crs, region = clip_region([{"geometry": mapping(polygon)}])
        project = Transformer.from_crs(4326, crs, always_xy=True).transform
        projected = transform(project, polygon)
        _, south, _, north = projected.bounds
        self.assertAlmostEqual(region.bounds[1], south - 914.4, delta=0.1)
        self.assertAlmostEqual(region.bounds[3], north + 914.4, delta=0.1)
        self.assertTrue(region.covers(projected))

    def test_published_segments_stay_inside_coverage(self):
        applications = json.loads((ROOT / "data/applications.json").read_text())
        crs, region = clip_region(applications)
        project = Transformer.from_crs(4326, crs, always_xy=True).transform
        source = json.loads((ROOT / "data/shorelines/esi-shorelines.geojson").read_text())
        published = json.loads((ROOT / "public/layers/shorelines.geojson").read_text())
        self.assertTrue(published["features"])
        source_by_id = {f["properties"]["shoreline_id"]: f for f in source["features"]}
        published_ids = [f["properties"]["shoreline_id"] for f in published["features"]]
        self.assertEqual(len(published_ids), len(set(published_ids)))
        self.assertEqual(set(published_ids), set(source_by_id))
        # WGS84 web coordinates are rounded to six decimals (~11 cm).
        tolerance = 0.2
        coverage = region.buffer(tolerance)
        for feature in published["features"]:
            shoreline_id = feature["properties"]["shoreline_id"]
            line = transform(project, shape(feature["geometry"]))
            original = transform(project, shape(source_by_id[shoreline_id]["geometry"]))
            self.assertTrue(line.is_valid and not line.is_empty, shoreline_id)
            self.assertIn(line.geom_type, {"LineString", "MultiLineString"})
            self.assertTrue(coverage.covers(line), shoreline_id)
            self.assertLessEqual(line.hausdorff_distance(original), tolerance, shoreline_id)


if __name__ == "__main__":
    unittest.main()
