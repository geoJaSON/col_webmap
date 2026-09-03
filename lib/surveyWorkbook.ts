import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { surveySheet } from "@/lib/surveyCsv";
import type { ReefType, SurveyPoint, SurveySample } from "@/lib/surveyTypes";

const TEMPLATE = path.join(process.cwd(), "survey_points", "Datasheet.xlsx");

const SHEETS: { name: string; reefType: ReefType }[] = [
  { name: "On-Reef_datasheet", reefType: "on" },
  { name: "Off-Reef_datasheet", reefType: "off" },
];

/**
 * Fill TPWD's supplied workbook for one application without changing its
 * sheet names, headers, widths, or styles. A workbook is site-specific because
 * the template identifies rows only by sample number; combining sites would
 * make repeated point numbers ambiguous.
 */
export async function surveyWorkbook(
  points: SurveyPoint[],
  samples: Map<string, SurveySample>,
  appNo: number,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const template = await readFile(TEMPLATE);
  const templateBuffer = template.buffer.slice(
    template.byteOffset,
    template.byteOffset + template.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(templateBuffer);

  for (const { name, reefType } of SHEETS) {
    const worksheet = workbook.getWorksheet(name);
    if (!worksheet) throw new Error(`Datasheet template is missing the ${name} sheet.`);

    const sheet = surveySheet(points, samples, { reefType, appNo });
    for (const [index, expected] of sheet.columns.entries()) {
      const actual = worksheet.getCell(1, index + 1).text;
      if (actual !== expected) {
        throw new Error(
          `Unexpected heading in ${name}!${worksheet.getCell(1, index + 1).address}: ` +
            `expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`,
        );
      }
    }

    // The committed template is empty, but clear stale rows if somebody
    // replaces it with a previously filled copy.
    if (worksheet.rowCount > 1) worksheet.spliceRows(2, worksheet.rowCount - 1);

    for (const { point, values } of sheet.rows) {
      const row = worksheet.addRow(values);
      // Coordinates are numbers in Excel while still displaying the six
      // decimals TPWD supplied and uses to match each assigned point.
      row.getCell(2).value = point.lat;
      row.getCell(2).numFmt = "0.000000";
      row.getCell(3).value = point.lon;
      row.getCell(3).numFmt = "0.000000";
    }
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(new Uint8Array(output));
}
