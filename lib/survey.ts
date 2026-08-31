"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Fix,
  SampleDraft,
  SurveyPoint,
  SurveySample,
  SurveySite,
} from "@/lib/surveyTypes";
import { draftToRow } from "@/lib/surveyTypes";

/**
 * Field survey data access, all of it browser-side as the signed-in surveyor.
 *
 * Unlike the COL applications -- which are read through this app's API routes
 * with the service-role key -- survey reads and writes go straight to Supabase
 * over the anon key, governed by the RLS policies in survey_schema.sql. That
 * is the same trust model as the polling layer, and it is what lets a photo go
 * from the tablet to Storage without a several-megabyte round trip through the
 * Next.js server on a boat's connection.
 */

export const PHOTO_BUCKET = "survey-photos";

/** Longest edge, in pixels, a survey photo is stored at. */
const MAX_PHOTO_EDGE = 2048;
const PHOTO_QUALITY = 0.85;

export type SurveyData = {
  sites: SurveySite[];
  points: SurveyPoint[];
  samples: SurveySample[];
};

/**
 * Everything the map needs in one go.
 *
 * 582 points and at most 582 samples is small enough that paging it would cost
 * more in round trips than it saves in bytes, and the crew needs the whole
 * assignment on screen to plan a run anyway.
 */
export async function fetchSurveyData(client: SupabaseClient): Promise<SurveyData> {
  const [sites, points, samples] = await Promise.all([
    client.from("survey_sites").select("*").order("app_no"),
    client.from("survey_points").select("*").order("app_no").order("point_no"),
    client.from("survey_samples").select("*"),
  ]);

  const failure = sites.error ?? points.error ?? samples.error;
  if (failure) throw new Error(`Could not load the survey: ${failure.message}`);

  return {
    sites: (sites.data ?? []).map((s) => ({
      ...s,
      // numeric() comes back from PostgREST as a string.
      on_reef_acres: s.on_reef_acres === null ? null : Number(s.on_reef_acres),
      off_reef_acres: s.off_reef_acres === null ? null : Number(s.off_reef_acres),
    })) as SurveySite[],
    points: (points.data ?? []).map((p) => ({
      ...p,
      lat: Number(p.lat),
      lon: Number(p.lon),
    })) as SurveyPoint[],
    samples: (samples.data ?? []).map(numbersFromSample),
  };
}

function numbersFromSample(row: Record<string, unknown>): SurveySample {
  const maybe = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    ...(row as unknown as SurveySample),
    gps_lat: maybe(row.gps_lat),
    gps_lon: maybe(row.gps_lon),
    gps_accuracy_m: maybe(row.gps_accuracy_m),
  };
}

/**
 * `75-012-20260831T1430Z.jpg` -- the site, the point, and when it was shot.
 *
 * Deterministic and self-describing on purpose: this string is what goes in
 * the datasheet's "Image File Name" column, and a name that says which sample
 * it belongs to survives being copied out of the bucket into a folder someone
 * emails to TPWD.
 */
export function photoFileName(point: SurveyPoint, takenAt = new Date()): string {
  const stamp = takenAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").slice(0, 16);
  return `${point.app_no}-${String(point.point_no).padStart(3, "0")}-${stamp}.jpg`;
}

/**
 * Shrink a tablet photo before it goes up.
 *
 * A modern phone camera produces 4-12 MB per shot; at 582 samples that is a
 * lot of bytes over a connection that may be one bar. 2048px on the longest
 * edge is still far more than anyone needs to see substrate and oysters, and
 * it turns a minute-long upload into a few seconds.
 *
 * If anything about the decode fails -- an HEIC the browser will not open, a
 * canvas that comes back empty -- the original file is returned rather than
 * losing the photo over an optimisation.
 */
export async function downscalePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg") {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Uploads the photo and returns its object path, or null if there was none. */
export async function uploadPhoto(
  client: SupabaseClient,
  point: SurveyPoint,
  file: File,
): Promise<string> {
  const body = await downscalePhoto(file);
  const path = `${point.app_no}/${photoFileName(point)}`;

  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, body, {
    contentType: "image/jpeg",
    // Re-shooting a sample's photo replaces it rather than piling up orphans.
    upsert: true,
  });
  if (error) throw new Error(`Could not upload the photo: ${error.message}`);
  return path;
}

/** A short-lived URL for showing a stored photo back to the crew. */
export async function photoUrl(
  client: SupabaseClient,
  path: string,
): Promise<string | null> {
  const { data, error } = await client.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

export type SaveInput = {
  point: SurveyPoint;
  draft: SampleDraft;
  fix: Fix | null;
  /** A newly taken photo, or null to keep whatever is already attached. */
  photo: File | null;
  /** Existing path, kept when no new photo was taken. */
  existingImagePath: string | null;
  userId: string;
};

/**
 * Write a sample.
 *
 * The only path by which an observation reaches the database, deliberately:
 * everything the form knows goes in here, so adding an offline queue later
 * means changing this function and nothing that calls it.
 *
 * Upserts on (app_no, point_no) because re-recording a point is a correction,
 * not a second sample -- which is what keeps the map's sampled/not-sampled
 * symbology honest.
 */
export async function saveSample(
  client: SupabaseClient,
  input: SaveInput,
): Promise<SurveySample> {
  const imagePath = input.photo
    ? await uploadPhoto(client, input.point, input.photo)
    : input.existingImagePath;

  const row = draftToRow(input.draft, input.point, input.fix, imagePath, input.userId);

  const { data, error } = await client
    .from("survey_samples")
    .upsert(row, { onConflict: "app_no,point_no" })
    .select()
    .single();

  if (error) throw new Error(friendlyError(error.message));
  return numbersFromSample(data as Record<string, unknown>);
}

/**
 * Constraint names are precise and unreadable. The form validates the same
 * rules first, so anything arriving here is a genuine surprise -- but it
 * should still say something a person on a boat can act on.
 */
function friendlyError(message: string): string {
  if (message.includes("survey_samples_sediment_total_check")) {
    return "Sediment percentages must add up to 100.";
  }
  if (message.includes("survey_samples_shape_check")) {
    return "The oyster fields do not match this point's reef type. Reopen the form and try again.";
  }
  if (message.includes("survey_samples_point_fkey")) {
    return "That sample point is not in the current assignment.";
  }
  return `Could not save the sample: ${message}`;
}

/**
 * A single GPS fix.
 *
 * `enableHighAccuracy` asks for the real GPS chip rather than a network guess,
 * which matters when the answer is going in a regulatory record. No cached
 * position is accepted: a fix from ten minutes ago is a different reef.
 */
export function currentFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device has no GPS available to the browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          takenAt: new Date(position.timestamp).toISOString(),
        }),
      (failure) => reject(new Error(gpsMessage(failure))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function gpsMessage(failure: GeolocationPositionError): string {
  switch (failure.code) {
    case failure.PERMISSION_DENIED:
      return "Location is blocked for this site. Allow it in the browser settings to stamp samples with a position.";
    case failure.POSITION_UNAVAILABLE:
      return "No GPS fix yet. Wait a moment with a clear view of the sky.";
    case failure.TIMEOUT:
      return "Timed out waiting for a GPS fix.";
    default:
      return "Could not get a GPS position.";
  }
}
