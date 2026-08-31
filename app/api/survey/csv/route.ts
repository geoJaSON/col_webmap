import { NextResponse, type NextRequest } from "next/server";

import { surveyToCsv } from "@/lib/surveyCsv";
import { SurveyUnavailable, loadSurveyForExport } from "@/lib/surveyStore";
import type { ReefType } from "@/lib/surveyTypes";

export const dynamic = "force-dynamic";

/**
 * The collected survey as CSV, in TPWD's datasheet layout.
 *
 *   /api/survey/csv?type=on&site=75   one worksheet's worth, exact columns
 *   /api/survey/csv?type=off          every site, plus App# and actual position
 *
 * `type` is required and has no default: the two datasheets have different
 * columns, and guessing which one someone meant would quietly hand them the
 * wrong sheet.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const type = params.get("type");
  if (type !== "on" && type !== "off") {
    return NextResponse.json(
      { error: "Pass type=on or type=off — the two datasheets have different columns." },
      { status: 400 },
    );
  }
  const reefType = type as ReefType;

  const rawSite = params.get("site");
  let appNo: number | null = null;
  if (rawSite !== null) {
    const parsed = Number(rawSite);
    if (!Number.isInteger(parsed)) {
      return NextResponse.json({ error: `Not an application number: ${rawSite}` }, { status: 400 });
    }
    appNo = parsed;
  }

  try {
    const { points, samples, sites } = await loadSurveyForExport();

    if (appNo !== null && !sites.some((site) => site.app_no === appNo)) {
      return NextResponse.json(
        { error: `No assigned samples for application ${appNo}.` },
        { status: 404 },
      );
    }

    const csv = surveyToCsv(points, samples, { reefType, appNo });

    const stamp = new Date().toISOString().slice(0, 10);
    const scope = appNo === null ? "all-sites" : `site-${appNo}`;
    const sheet = reefType === "on" ? "on-reef" : "off-reef";

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sheet}-${scope}-${stamp}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof SurveyUnavailable) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
