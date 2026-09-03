import type { ReefType, SurveyPoint, SurveySample } from "@/lib/surveyTypes";

/**
 * The collected survey, back in TPWD's own datasheet layout.
 *
 * The column names below are copied verbatim from Datasheet.xlsx -- including
 * its inconsistent spacing around the size thresholds ("(>25 mm)" on one row,
 * "(>25mm)" on the next). They are not tidied up on purpose: this file exists
 * to drop into the workbook TPWD sent, and a "corrected" header is a column
 * their sheet does not recognise.
 */

export const ON_REEF_COLUMNS = [
  "Sample Number",
  "Latitude",
  "Longitude",
  "# of Live Oysters (6-25mm)",
  "# of Live Oysters (>25 mm)",
  "# of Oyster Shells (>25 mm)",
  "# of Black Oyster Shells (>25mm)",
  "Presence of Seagrass (Y/N)",
  "Percentage of Sediment: Mud",
  "Percentage of Sediment: Sand",
  "Percentage of Sediment: Shell hash",
  "Image File Name",
] as const;

export const OFF_REEF_COLUMNS = [
  "Sample Number",
  "Latitude",
  "Longitude",
  "Presence of Live Oysters (Y/N)",
  "Presence of Seagrass (Y/N)",
  "Percentage of Sediment: Mud",
  "Percentage of Sediment: Sand",
  "Percentage of Sediment: Shell hash",
  "Image File Name",
] as const;

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const yesNo = (value: boolean | null) => (value === null ? "" : value ? "Y" : "N");
const orBlank = (value: number | null) => (value === null ? "" : value);

/** The bucket path is `<app_no>/<file>`; the datasheet wants just the file. */
const fileNameOf = (path: string | null) => (path ? path.split("/").pop() ?? "" : "");

export type SurveyCsvOptions = {
  reefType: ReefType;
  /** A single application number, or null for every site in one file. */
  appNo: number | null;
};

export type SurveySheetRow = {
  point: SurveyPoint;
  sample: SurveySample | null;
  values: (string | number)[];
};

/** The exact columns and rows accepted by the two sheets in Datasheet.xlsx. */
export function surveySheet(
  points: SurveyPoint[],
  samples: Map<string, SurveySample>,
  options: SurveyCsvOptions,
): { columns: readonly string[]; rows: SurveySheetRow[] } {
  const { reefType, appNo } = options;
  const onReef = reefType === "on";

  const wanted = points
    .filter((point) => point.reef_type === reefType)
    .filter((point) => appNo === null || point.app_no === appNo)
    .sort((a, b) => a.app_no - b.app_no || a.point_no - b.point_no);

  return {
    columns: onReef ? ON_REEF_COLUMNS : OFF_REEF_COLUMNS,
    rows: wanted.map((point) => {
      const sample = samples.get(`${point.app_no}:${point.point_no}`) ?? null;
      const shared = [point.point_no, point.lat.toFixed(6), point.lon.toFixed(6)];
      const observations = onReef
        ? [
            orBlank(sample?.live_oysters_6_25mm ?? null),
            orBlank(sample?.live_oysters_gt_25mm ?? null),
            orBlank(sample?.oyster_shells_gt_25mm ?? null),
            orBlank(sample?.black_oyster_shells_gt_25mm ?? null),
          ]
        : [yesNo(sample?.live_oysters_present ?? null)];
      const tail = [
        yesNo(sample?.seagrass ?? null),
        orBlank(sample?.pct_mud ?? null),
        orBlank(sample?.pct_sand ?? null),
        orBlank(sample?.pct_shell_hash ?? null),
        fileNameOf(sample?.image_path ?? null),
      ];

      return { point, sample, values: [...shared, ...observations, ...tail] };
    }),
  };
}

/**
 * Rows follow the *assignment*, not the collection: every point TPWD assigned
 * appears, and one that has not been sampled yet comes through with its
 * coordinate and empty observation cells. A sheet that silently omitted
 * outstanding points would read as a complete survey.
 *
 * Latitude and Longitude are the assigned coordinates, because those are what
 * TPWD matches against. Where the boat actually was is recorded too, and comes
 * out in the `Actual` columns when `appNo` is null -- see below.
 */
export function surveyToCsv(
  points: SurveyPoint[],
  samples: Map<string, SurveySample>,
  options: SurveyCsvOptions,
): string {
  const { reefType, appNo } = options;
  const sheet = surveySheet(points, samples, options);
  const base = [...sheet.columns];

  // One site is a drop-in for that site's worksheet, so its columns must match
  // exactly. An all-sites export is an internal roll-up and cannot be dropped
  // into any single worksheet anyway, so it gains the columns that make it
  // useful: which site each row belongs to, and the position actually held.
  const header =
    appNo === null
      ? ["App#", ...base, "Actual Latitude", "Actual Longitude", "GPS Accuracy (m)", "Recorded At"]
      : base;

  const rows = sheet.rows.map(({ point, sample, values }) => {
    const row = values.map(cell);

    if (appNo === null) {
      return [
        cell(point.app_no),
        ...row,
        cell(sample?.gps_lat === null || sample?.gps_lat === undefined ? "" : sample.gps_lat.toFixed(6)),
        cell(sample?.gps_lon === null || sample?.gps_lon === undefined ? "" : sample.gps_lon.toFixed(6)),
        cell(sample?.gps_accuracy_m ?? ""),
        cell(sample?.recorded_at ?? ""),
      ].join(",");
    }

    return row.join(",");
  });

  // CRLF and a BOM: what Excel on Windows expects to open cleanly.
  return "﻿" + [header.map(cell).join(","), ...rows].join("\r\n") + "\r\n";
}
