import { PassThrough, Readable } from "node:stream";

import { ZipArchive } from "archiver";
import { NextResponse, type NextRequest } from "next/server";

import {
  SurveyUnavailable,
  downloadSurveyPhoto,
  loadSurveyForExport,
} from "@/lib/surveyStore";
import { surveyWorkbook } from "@/lib/surveyWorkbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fileName = (objectPath: string) => objectPath.split("/").pop() || "photo.jpg";

/**
 * Every assigned site gets its own folder containing a filled copy of TPWD's
 * Datasheet.xlsx and the photos named in that workbook. Keeping workbooks
 * site-specific is essential: the supplied sheets have no application-number
 * column, so point numbers repeat across sites.
 *
 *   /api/survey/archive           every assigned site, one folder each
 *   /api/survey/archive?site=75   one site -- what each area's card links to
 */
export async function GET(request: NextRequest) {
  const rawSite = request.nextUrl.searchParams.get("site");
  let appNo: number | null = null;
  if (rawSite !== null) {
    const parsed = Number(rawSite);
    if (!Number.isInteger(parsed)) {
      return NextResponse.json({ error: `Not an application number: ${rawSite}` }, { status: 400 });
    }
    appNo = parsed;
  }

  try {
    const data = await loadSurveyForExport();
    const sites = appNo === null ? data.sites : data.sites.filter((site) => site.app_no === appNo);
    // Checked before the stream starts, while a plain error response is still
    // possible -- afterwards the only way to fail is a broken download.
    if (appNo !== null && sites.length === 0) {
      return NextResponse.json({ error: `No assigned samples for application ${appNo}.` }, { status: 404 });
    }
    const output = new PassThrough();
    // Photos are already compressed JPEGs; storing them avoids wasting server
    // time recompressing hundreds of files for negligible size reduction.
    const zip = new ZipArchive({ store: true });
    zip.pipe(output);
    zip.on("error", (error) => output.destroy(error));

    // Start producing entries after the streaming response has been created.
    void (async () => {
      const warnings: string[] = [];

      for (const site of sites) {
        const folder = String(site.app_no);
        const workbook = await surveyWorkbook(data.points, data.samples, site.app_no);
        zip.append(workbook, { name: `${folder}/Datasheet.xlsx` });

        const photoPaths = [...data.samples.values()]
          .filter((sample) => sample.app_no === site.app_no && sample.image_path)
          .map((sample) => sample.image_path as string)
          .sort();

        // A little concurrency keeps a large field-day export moving without
        // holding hundreds of photographs in server memory at once.
        for (let index = 0; index < photoPaths.length; index += 4) {
          const batch = photoPaths.slice(index, index + 4);
          const photos = await Promise.all(
            batch.map(async (photoPath) => {
              try {
                const blob = await downloadSurveyPhoto(photoPath);
                return { photoPath, body: Buffer.from(await blob.arrayBuffer()) };
              } catch (error) {
                warnings.push(error instanceof Error ? error.message : `Could not download ${photoPath}`);
                return null;
              }
            }),
          );

          for (const photo of photos) {
            if (photo) zip.append(photo.body, { name: `${folder}/${fileName(photo.photoPath)}` });
          }
        }
      }

      if (warnings.length > 0) {
        zip.append(
          "The following referenced photos could not be included:\r\n\r\n" + warnings.join("\r\n") + "\r\n",
          { name: "EXPORT-WARNINGS.txt" },
        );
      }

      await zip.finalize();
    })().catch((error) => {
      zip.abort();
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(Readable.toWeb(output) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="ground-samples${appNo === null ? "" : `-site-${appNo}`}-${stamp}.zip"`,
        "Cache-Control": "no-store",
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
