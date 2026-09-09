"""
TPWD ground-sample workbooks -> data/survey_points.json, supabase/survey_seed.sql,
exports/col-ground-samples.gpx

TPWD assigns every ground sample: a coordinate (decimal degrees, WGS84) and a
reef class, which decides which datasheet the crew fills in. This reads every
assignment workbook in survey_points/ and emits a JSON copy for the app,
idempotent SQL for Supabase, and a GPX for the chartplotter.

Workbooks arrive in batches and are *discovered*, not listed -- drop the next
one in the folder and re-run. Each is one worksheet per application. Point
numbers restart at 1 in each sheet, so the key is (app_no, point_no), not
point_no alone; an application appearing in two workbooks is an error rather
than a silent overwrite.

Two shapes TPWD has used so far, both accepted:

  sheet name   "75 (GB20)" in the Galveston workbooks, bare "112" in the
               Aransas Bay one, which carries no site code at all.

  reef class   "On Reef" and "Off Reef" everywhere, plus "Off Reef Seagrass"
               in Aransas Bay. The third maps to reef_type 'off' -- it is
               recorded on the off-reef datasheet, and TPWD only ever sent two
               sheets -- while reef_label keeps their exact wording, because a
               seagrass sample needs different gear aboard.

Layout note: columns A-F are the per-point rows. Columns H-I are a two-row
summary of on-reef / off-reef *acreage* for the site, parked beside the data
rather than below it. They are not per-point values and are read separately;
the per-point classification is the `Reef` column (E).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX_DIR = ROOT / "survey_points"
# The blank TPWD datasheet lives alongside the assignments but is a template,
# not a set of points.
NOT_AN_ASSIGNMENT = {"Datasheet.xlsx"}
JSON_OUT = ROOT / "data" / "survey_points.json"
SQL_OUT = ROOT / "supabase" / "survey_seed.sql"
GPX_OUT = ROOT / "exports" / "col-ground-samples.gpx"

# TPWD's own wording, which varies between workbooks and between the per-point
# `Reef` column and the acreage summary beside it -- "Off Reef Seagrass" in one
# place, "Off Reef (potential seagrass)" in the other. Whitespace is collapsed
# before lookup, so "on  reef" matches too.
#
# Everything that is not on-reef maps to 'off', because that is what decides
# which of TPWD's two datasheets the crew fills in and they only ever sent two.
# The distinction is not thrown away: the verbatim label rides along as
# reef_label, because a seagrass sample is worked with different gear and the
# crew has to know that before they leave the dock.
REEF_ALIASES = {
    "on reef": "on",
    "off reef": "off",
    "off reef seagrass": "off",
    "off reef (potential seagrass)": "off",
    "off reef potential seagrass": "off",
}

# The Texas coast, Sabine to the Rio Grande. Wide enough for every bay system
# TPWD assigns in and still tight enough that a transposed or truncated
# coordinate is caught rather than plotted in the Gulf.
LAT_RANGE = (25.8, 30.3)
LON_RANGE = (-97.6, -93.5)

# "75 (GB20)", or just "112" -- the Aransas Bay workbook has no TPWD site code,
# so the parenthesised part is optional.
SHEET_RE = re.compile(r"^\s*(\d+)\s*(?:\(([^)]*)\))?\s*$")


def normalise(value) -> str:
    """Collapse the workbook's erratic whitespace so lookups are stable."""
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def parse_sheet_title(title: str) -> tuple[int, str | None]:
    """'75 (GB20)' -> (75, 'GB20');  '112' -> (112, None)"""
    match = SHEET_RE.match(title)
    if not match:
        raise ValueError(
            f"Unexpected worksheet name {title!r}; expected '<app#>' or '<app#> (<site code>)'."
        )
    code = (match.group(2) or "").strip()
    return int(match.group(1)), code or None


def read_acreage(ws) -> dict[str, float | None]:
    """The H/I summary block: on-reef and off-reef acreage for the site."""
    acres: dict[str, float | None] = {"on": None, "off": None}
    for row in ws.iter_rows(min_row=2, max_row=6, min_col=8, max_col=9, values_only=True):
        label, value = (row + (None, None))[:2]
        key = REEF_ALIASES.get(normalise(label))
        if key and isinstance(value, (int, float)):
            acres[key] = float(value)
    return acres


def read_points(ws, app_no: int) -> list[dict]:
    points: list[dict] = []
    seen: set[int] = set()

    for index, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        cells = (list(row) + [None] * 6)[:6]
        sheet_app, point_no, lat, lon, reef, datum = cells

        # Rows that only carry the H/I summary have an empty A column.
        if sheet_app is None and point_no is None:
            continue

        if int(sheet_app) != app_no:
            raise ValueError(
                f"{ws.title} row {index}: App# {sheet_app} does not match the sheet's {app_no}."
            )

        reef_label = re.sub(r"\s+", " ", str(reef or "")).strip()
        reef_type = REEF_ALIASES.get(normalise(reef))
        if reef_type is None:
            raise ValueError(
                f"{ws.title} row {index}: unrecognised Reef value {reef!r}. "
                f"Add it to REEF_ALIASES if TPWD has introduced a new class."
            )

        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            raise ValueError(f"{ws.title} row {index}: non-numeric coordinate {lat!r}, {lon!r}.")

        if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]):
            raise ValueError(
                f"{ws.title} row {index}: point {point_no} at {lat}, {lon} is off the Texas coast."
            )

        # WGS84 is what the app and MapLibre assume; a sheet in anything else
        # would be silently wrong by tens of metres.
        if "wgs" not in normalise(datum):
            raise ValueError(f"{ws.title} row {index}: unexpected datum {datum!r}, expected WGS 1984.")

        point_no = int(point_no)
        if point_no in seen:
            raise ValueError(f"{ws.title}: point {point_no} appears twice.")
        seen.add(point_no)

        points.append(
            {
                "app_no": app_no,
                "point_no": point_no,
                "lat": round(float(lat), 6),
                "lon": round(float(lon), 6),
                "reef_type": reef_type,
                # TPWD's own wording, kept verbatim. 'off' alone would lose the
                # fact that a point sits in potential seagrass, which changes
                # the gear the crew needs aboard.
                "reef_label": reef_label,
            }
        )

    return sorted(points, key=lambda p: p["point_no"])


def escape_xml(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_gpx(sites: list[dict], points: list[dict]) -> None:
    """
    The assigned points as GPX 1.1, for loading onto a chartplotter.

    Waypoints are named "75-001" -- zero padded, because handhelds list
    waypoints alphabetically and unpadded numbers sort 1, 10, 100, 2, which is
    unusable when you are hunting for point 2 of 104. The longest name this
    produces is "107-104", seven characters, inside the limit of any device
    likely to see it.

    The symbol is TPWD's reef class, which is what decides the gear: red
    on-reef, blue off-reef, green off-reef in potential seagrass. These are the
    Garmin names, which most plotters and OpenCPN understand; an unrecognised
    symbol falls back to a default pin rather than failing the file.

    Note the child order inside <metadata> and <wpt>. It is not stylistic --
    the GPX 1.1 schema is a sequence, so a device that validates will reject
    the file if <sym> comes before <desc>.
    """
    codes = {s["app_no"]: s["site_code"] for s in sites}

    def symbol(point: dict) -> str:
        if point["reef_type"] == "on":
            return "Flag, Red"
        return "Flag, Green" if "seagrass" in point["reef_label"].lower() else "Flag, Blue"

    lats = [p["lat"] for p in points]
    lons = [p["lon"] for p in points]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="COL Status"'
        ' xmlns="http://www.topografix.com/GPX/1/1"'
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
        ' xsi:schemaLocation="http://www.topografix.com/GPX/1/1'
        ' http://www.topografix.com/GPX/1/1/gpx.xsd">',
        "  <metadata>",
        "    <name>COL assigned ground samples</name>",
        "    <desc>{} assigned TPWD ground samples across {} sites."
        " Red is on-reef, blue is off-reef, green is off-reef potential"
        " seagrass.</desc>".format(len(points), len(sites)),
        f"    <time>{stamp}</time>",
        '    <bounds minlat="{:.6f}" minlon="{:.6f}" maxlat="{:.6f}" maxlon="{:.6f}"/>'.format(
            min(lats), min(lons), max(lats), max(lons)
        ),
        "  </metadata>",
    ]

    for p in points:
        code = codes.get(p["app_no"])
        # TPWD's own wording, so the plotter says the same thing the workbook
        # and the form do.
        desc = "Site {}{} point {} - {}".format(
            p["app_no"], f" ({code})" if code else "", p["point_no"], p["reef_label"]
        )
        out += [
            '  <wpt lat="{:.6f}" lon="{:.6f}">'.format(p["lat"], p["lon"]),
            "    <name>{}-{:03d}</name>".format(p["app_no"], p["point_no"]),
            f"    <desc>{escape_xml(desc)}</desc>",
            f"    <sym>{escape_xml(symbol(p))}</sym>",
            "    <type>{}</type>".format("on-reef" if p["reef_type"] == "on" else "off-reef"),
            "  </wpt>",
        ]

    out.append("</gpx>")
    GPX_OUT.parent.mkdir(parents=True, exist_ok=True)
    GPX_OUT.write_text("\n".join(out) + "\n", encoding="utf-8")


def sql_literal(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def workbooks() -> list[Path]:
    """
    Every assignment workbook in survey_points/, oldest name first.

    Discovered rather than listed, so the next batch TPWD sends is imported by
    dropping the file in and re-running -- no code change, which is the whole
    point of a seed script that has to keep up with a rolling assignment.
    """
    found = sorted(
        p for p in XLSX_DIR.glob("*.xlsx")
        if p.name not in NOT_AN_ASSIGNMENT and not p.name.startswith("~$")
    )
    if not found:
        raise SystemExit(f"No assignment workbooks found in {XLSX_DIR}.")
    return found


def main() -> None:
    sites: list[dict] = []
    points: list[dict] = []
    # (app_no -> workbook) so a site sent twice is caught rather than silently
    # taking whichever file happened to be read last.
    seen_apps: dict[int, str] = {}

    for path in workbooks():
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        for ws in wb.worksheets:
            app_no, site_code = parse_sheet_title(ws.title)

            if app_no in seen_apps:
                raise ValueError(
                    f"Application {app_no} appears in both {seen_apps[app_no]} and "
                    f"{path.name}. Remove the superseded workbook before re-running."
                )
            seen_apps[app_no] = path.name

            sheet_points = read_points(ws, app_no)
            acres = read_acreage(ws)

            sites.append(
                {
                    "app_no": app_no,
                    "site_code": site_code,
                    "on_reef_acres": acres["on"],
                    "off_reef_acres": acres["off"],
                    "on_reef_points": sum(1 for p in sheet_points if p["reef_type"] == "on"),
                    "off_reef_points": sum(1 for p in sheet_points if p["reef_type"] == "off"),
                    "source": path.name,
                }
            )
            points.extend(sheet_points)

    sites.sort(key=lambda s: s["app_no"])
    points.sort(key=lambda p: (p["app_no"], p["point_no"]))

    JSON_OUT.write_text(
        json.dumps({"sites": sites, "points": points}, indent=2) + "\n", encoding="utf-8"
    )

    lines = [
        "-- Assigned ground samples, generated by scripts/extract_survey_points.py.",
        "-- Do not edit by hand: re-run the script when TPWD sends more points.",
        "-- Re-runnable -- on conflict the assignment is refreshed, and nothing here",
        "-- touches survey_samples, so re-seeding never disturbs collected data.",
        "",
    ]

    lines.append("insert into public.survey_sites (app_no, site_code, on_reef_acres, off_reef_acres) values")
    lines.append(
        ",\n".join(
            "  ({}, {}, {}, {})".format(
                s["app_no"], sql_literal(s["site_code"]),
                sql_literal(s["on_reef_acres"]), sql_literal(s["off_reef_acres"]),
            )
            for s in sites
        )
        + "\non conflict (app_no) do update set"
        + "\n  site_code = excluded.site_code,"
        + "\n  on_reef_acres = excluded.on_reef_acres,"
        + "\n  off_reef_acres = excluded.off_reef_acres;"
    )
    lines.append("")

    lines.append(
        "insert into public.survey_points"
        " (app_no, point_no, lat, lon, reef_type, reef_label) values"
    )
    lines.append(
        ",\n".join(
            "  ({}, {}, {}, {}, {}, {})".format(
                p["app_no"], p["point_no"], p["lat"], p["lon"],
                sql_literal(p["reef_type"]), sql_literal(p["reef_label"]),
            )
            for p in points
        )
        + "\non conflict (app_no, point_no) do update set"
        + "\n  lat = excluded.lat,"
        + "\n  lon = excluded.lon,"
        + "\n  reef_type = excluded.reef_type,"
        + "\n  reef_label = excluded.reef_label;"
    )
    lines.append("")

    SQL_OUT.write_text("\n".join(lines), encoding="utf-8")

    write_gpx(sites, points)

    on = sum(s["on_reef_points"] for s in sites)
    off = sum(s["off_reef_points"] for s in sites)
    print(f"{len(sites)} sites, {len(points)} points ({on} on-reef, {off} off-reef)")
    # Grouped by workbook, because that is how TPWD sends them and how you
    # check a new batch landed in full.
    for source in sorted({s["source"] for s in sites}):
        batch = [s for s in sites if s["source"] == source]
        print(f"\n  {source}  ({len(batch)} sites, {sum(s['on_reef_points'] + s['off_reef_points'] for s in batch)} points)")
        for s in batch:
            code = f" ({s['site_code']})" if s["site_code"] else ""
            print(
                f"    {s['app_no']:>4}{code:<12} "
                f"{s['on_reef_points']:>3} on / {s['off_reef_points']:>3} off"
            )

    labels: dict[str, int] = {}
    for p in points:
        labels[p["reef_label"]] = labels.get(p["reef_label"], 0) + 1
    print("\n  TPWD reef classes:")
    for label, count in sorted(labels.items()):
        print(f"    {label:<32} {count:>4}")
    print()
    print(f"-> {JSON_OUT.relative_to(ROOT)}")
    print(f"-> {SQL_OUT.relative_to(ROOT)}")
    print(f"-> {GPX_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
