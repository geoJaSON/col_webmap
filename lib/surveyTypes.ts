/**
 * Field survey types.
 *
 * TPWD assigns every ground sample a coordinate and a type -- on-reef or
 * off-reef -- and the type decides which datasheet the crew fills in. The two
 * sheets share seagrass and the sediment split but diverge on oysters:
 * on-reef counts four size/condition classes, off-reef records presence only.
 * That fork runs through the form, the constraints, and the export, so it is
 * modelled once here.
 */

export type ReefType = "on" | "off";

export const REEF_LABEL: Record<ReefType, string> = {
  on: "On reef",
  off: "Off reef",
};

/** An assigned sample location. Seeded from TPWD's workbook, never edited. */
export type SurveyPoint = {
  app_no: number;
  point_no: number;
  lat: number;
  lon: number;
  reef_type: ReefType;
};

export type SurveySite = {
  app_no: number;
  site_code: string;
  on_reef_acres: number | null;
  off_reef_acres: number | null;
};

/** What the crew recorded at a point. */
export type SurveySample = {
  id: number;
  app_no: number;
  point_no: number;
  reef_type: ReefType;

  /** Where the boat actually was, as distinct from where the point was assigned. */
  gps_lat: number | null;
  gps_lon: number | null;
  gps_accuracy_m: number | null;
  gps_taken_at: string | null;

  seagrass: boolean;
  pct_mud: number;
  pct_sand: number;
  pct_shell_hash: number;

  live_oysters_6_25mm: number | null;
  live_oysters_gt_25mm: number | null;
  oyster_shells_gt_25mm: number | null;
  black_oyster_shells_gt_25mm: number | null;

  live_oysters_present: boolean | null;

  image_path: string | null;
  notes: string | null;

  recorded_by: string;
  recorded_at: string;
  updated_by: string | null;
  updated_at: string;
};

/**
 * The form's own shape. Counts are held as strings because a partly-typed
 * number field is a normal intermediate state on a tablet -- "" and "1" are
 * both things a person is in the middle of doing, and coercing to a number too
 * early turns an empty box into a 0 nobody chose.
 */
export type SampleDraft = {
  seagrass: boolean | null;
  pctMud: string;
  pctSand: string;
  pctShellHash: string;
  liveOysters6to25: string;
  liveOystersGt25: string;
  oysterShellsGt25: string;
  blackOysterShellsGt25: string;
  liveOystersPresent: boolean | null;
  notes: string;
};

export const emptyDraft = (): SampleDraft => ({
  seagrass: null,
  pctMud: "",
  pctSand: "",
  pctShellHash: "",
  liveOysters6to25: "",
  liveOystersGt25: "",
  oysterShellsGt25: "",
  blackOysterShellsGt25: "",
  liveOystersPresent: null,
  notes: "",
});

/** Reopen an existing sample for correction. */
export function draftFromSample(sample: SurveySample): SampleDraft {
  const text = (value: number | null) => (value === null ? "" : String(value));
  return {
    seagrass: sample.seagrass,
    pctMud: text(sample.pct_mud),
    pctSand: text(sample.pct_sand),
    pctShellHash: text(sample.pct_shell_hash),
    liveOysters6to25: text(sample.live_oysters_6_25mm),
    liveOystersGt25: text(sample.live_oysters_gt_25mm),
    oysterShellsGt25: text(sample.oyster_shells_gt_25mm),
    blackOysterShellsGt25: text(sample.black_oyster_shells_gt_25mm),
    liveOystersPresent: sample.live_oysters_present,
    notes: sample.notes ?? "",
  };
}

/** A whole non-negative number, or null if the box is empty or not one. */
function count(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export type DraftErrors = Partial<Record<keyof SampleDraft | "sediment", string>>;

/**
 * Validate a draft against the rules the database will apply anyway.
 *
 * Deliberately the same rules as the CHECK constraints in survey_schema.sql,
 * because a constraint violation surfacing as a Postgres error message on a
 * boat is not a usable answer. The database stays the authority; this is the
 * part that explains itself.
 */
export function validateDraft(draft: SampleDraft, reefType: ReefType): DraftErrors {
  const errors: DraftErrors = {};

  if (draft.seagrass === null) errors.seagrass = "Required.";

  const mud = count(draft.pctMud);
  const sand = count(draft.pctSand);
  const hash = count(draft.pctShellHash);

  if (mud === null) errors.pctMud = "Required.";
  if (sand === null) errors.pctSand = "Required.";
  if (hash === null) errors.pctShellHash = "Required.";

  if (mud !== null && sand !== null && hash !== null) {
    const total = mud + sand + hash;
    if (total !== 100) {
      errors.sediment = `Sediment must total 100%. Currently ${total}%.`;
    }
  }

  if (reefType === "on") {
    const fields: [keyof SampleDraft, string][] = [
      ["liveOysters6to25", "liveOysters6to25"],
      ["liveOystersGt25", "liveOystersGt25"],
      ["oysterShellsGt25", "oysterShellsGt25"],
      ["blackOysterShellsGt25", "blackOysterShellsGt25"],
    ];
    for (const [key] of fields) {
      if (count(draft[key] as string) === null) {
        errors[key] = "Required — enter 0 if none.";
      }
    }
  } else if (draft.liveOystersPresent === null) {
    errors.liveOystersPresent = "Required.";
  }

  return errors;
}

export const hasErrors = (errors: DraftErrors) => Object.keys(errors).length > 0;

/** The GPS fix a sample is stamped with, straight from the Geolocation API. */
export type Fix = {
  lat: number;
  lon: number;
  accuracy: number;
  takenAt: string;
};

/**
 * Draft plus fix plus photo -> the row shape the table expects.
 *
 * `recorded_by` is set here to satisfy the insert policy, but the trigger
 * overwrites it from the JWT regardless -- so this is a formality, not the
 * thing that decides whose name ends up on the sample.
 */
export function draftToRow(
  draft: SampleDraft,
  point: SurveyPoint,
  fix: Fix | null,
  imagePath: string | null,
  userId: string,
) {
  const onReef = point.reef_type === "on";
  const num = (value: string) => (value.trim() ? Number(value.trim()) : null);

  return {
    app_no: point.app_no,
    point_no: point.point_no,
    reef_type: point.reef_type,

    gps_lat: fix?.lat ?? null,
    gps_lon: fix?.lon ?? null,
    // One decimal is well past what a consumer GPS chip actually knows.
    gps_accuracy_m: fix ? Number(fix.accuracy.toFixed(1)) : null,
    gps_taken_at: fix?.takenAt ?? null,

    seagrass: draft.seagrass,
    pct_mud: num(draft.pctMud),
    pct_sand: num(draft.pctSand),
    pct_shell_hash: num(draft.pctShellHash),

    live_oysters_6_25mm: onReef ? num(draft.liveOysters6to25) : null,
    live_oysters_gt_25mm: onReef ? num(draft.liveOystersGt25) : null,
    oyster_shells_gt_25mm: onReef ? num(draft.oysterShellsGt25) : null,
    black_oyster_shells_gt_25mm: onReef ? num(draft.blackOysterShellsGt25) : null,

    live_oysters_present: onReef ? null : draft.liveOystersPresent,

    image_path: imagePath,
    notes: draft.notes.trim() || null,

    recorded_by: userId,
  };
}

/**
 * Great-circle distance in feet, used to show how far the boat was from the
 * assigned coordinate when the sample was taken. Feet because that is the unit
 * every other distance in this correspondence uses -- 132 ft tows, 200 ft
 * survey buffers.
 */
export function distanceFeet(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 20902231; // Earth radius in feet.
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A standard dredge tow covers ~132 linear feet, so the boat being a tow-length
 * or so off the assigned mark is expected. Past this it is worth a second look
 * before submitting -- a warning, never a block, because the crew is there and
 * the app is not.
 */
export const FAR_FROM_POINT_FEET = 150;
