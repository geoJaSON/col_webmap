"""Check snapshot scope and read-only export pagination, without credentials."""
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from shapely.geometry import Point, box, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from snapshot_polling import Database, ROOT, chunk_for, selected_point


class SnapshotTests(unittest.TestCase):
    def test_scope(self):
        bays, cols = prep(box(0, 0, 10, 10)), prep(box(20, 20, 21, 21))
        def row(x, y, lease=None):
            return {"id": "sample", "geom": mapping(Point(x, y)), "lease_number": lease}
        self.assertTrue(selected_point(row(5, 5), bays, cols))
        self.assertFalse(selected_point(row(5, 5, "other-lease"), bays, cols))
        self.assertTrue(selected_point(row(20.5, 20.5, "lease-in-col"), bays, cols))
        self.assertTrue(selected_point(row(20, 20, "lease-on-col-boundary"), bays, cols))
        self.assertFalse(selected_point(row(11, 11), bays, cols))

    def test_pagination_detects_missing_rows(self):
        class Response:
            headers = {"Content-Range": "0-0/2"}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'[{"id": "a"}]'
        db = Database.__new__(Database)
        db.url, db.headers = "https://example.invalid", {}
        with patch("snapshot_polling.urlopen", return_value=Response()):
            with self.assertRaisesRegex(ValueError, "pagination did not advance"):
                db.rows("gis_polling_points", {})

    def test_published_data(self):
        root = ROOT / "public" / "polling"
        metadata = json.loads((root / "index.json").read_text())
        directory = root / metadata["snapshotId"]
        coverage = json.loads((directory / "coverage.geojson").read_text())["features"]
        bays = prep(shape(next(f["geometry"] for f in coverage if f["properties"]["kind"] == "bays")))
        cols = prep(unary_union([shape(f["geometry"]) for f in coverage if f["properties"]["kind"] == "col"]))
        ids = set()
        unleased, inside = 0, 0
        for chunk in metadata["chunks"]:
            file = directory / f"{chunk['x']}-{chunk['y']}.geojson"
            self.assertEqual(file.stat().st_size, chunk["bytes"])
            features = json.loads(file.read_text())["features"]
            self.assertEqual(len(features), chunk["features"])
            for f in features:
                self.assertNotIn(f["id"], ids)
                ids.add(f["id"])
                row = {"id": f["id"], "geom": f["geometry"], **f["properties"]}
                self.assertTrue(selected_point(row, bays, cols), f["id"])
                self.assertEqual(chunk_for(*f["geometry"]["coordinates"]), (chunk["x"], chunk["y"]))
                unleased += row["lease_number"] is None
                inside += cols.covers(shape(row["geom"]))
                self.assertEqual(set(f["properties"]), {"substrate", "lease_number", "poll_year"})
        self.assertEqual(len(ids), metadata["features"])
        self.assertEqual(unleased, metadata["unleasedFeatures"])
        self.assertEqual(inside, metadata["colFeatures"])
        self.assertEqual(len(ids) - unleased, metadata["leasedColFeatures"])


if __name__ == "__main__":
    unittest.main()
