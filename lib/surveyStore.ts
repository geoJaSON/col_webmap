import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SurveyPoint, SurveySample, SurveySite } from "@/lib/surveyTypes";

const PHOTO_BUCKET = "survey-photos";

/**
 * Server-side survey reads, for the export route only.
 *
 * The app itself reads the survey from the browser under RLS; this is the one
 * place that needs the service-role key instead, because an export has to
 * cover every sample the crew collected regardless of who is downloading it,
 * and it is produced as a file rather than a page.
 */

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Thrown when the export is asked for without a database behind it. */
export class SurveyUnavailable extends Error {
  constructor() {
    super("No database configured — the survey cannot be exported.");
    this.name = "SurveyUnavailable";
  }
}

export type SurveyExportData = {
  sites: SurveySite[];
  points: SurveyPoint[];
  samples: Map<string, SurveySample>;
};

export async function loadSurveyForExport(): Promise<SurveyExportData> {
  const db = supabase();
  if (!db) throw new SurveyUnavailable();

  const [sites, points, samples] = await Promise.all([
    db.from("survey_sites").select("*").order("app_no"),
    db.from("survey_points").select("*").order("app_no").order("point_no"),
    db.from("survey_samples").select("*"),
  ]);

  const failure = sites.error ?? points.error ?? samples.error;
  if (failure) throw new Error(`Could not read the survey: ${failure.message}`);

  const number = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);

  return {
    sites: (sites.data ?? []).map((s) => ({
      ...s,
      on_reef_acres: number(s.on_reef_acres),
      off_reef_acres: number(s.off_reef_acres),
    })) as SurveySite[],
    points: (points.data ?? []).map((p) => ({
      ...p,
      lat: Number(p.lat),
      lon: Number(p.lon),
    })) as SurveyPoint[],
    samples: new Map(
      (samples.data ?? []).map((row) => [
        `${row.app_no}:${row.point_no}`,
        {
          ...row,
          gps_lat: number(row.gps_lat),
          gps_lon: number(row.gps_lon),
          gps_accuracy_m: number(row.gps_accuracy_m),
        } as SurveySample,
      ]),
    ),
  };
}

/** Download one private photo under the server's service-role credentials. */
export async function downloadSurveyPhoto(path: string): Promise<Blob> {
  const db = supabase();
  if (!db) throw new SurveyUnavailable();

  const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Could not download photo ${path}: ${error?.message ?? "empty response"}`);
  }
  return data;
}
