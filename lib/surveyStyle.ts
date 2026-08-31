import type { SurveyPoint, SurveySample } from "@/lib/surveyTypes";
import { pointKey } from "@/lib/useSurvey";

/**
 * Survey point symbology.
 *
 * Two things have to be readable at a glance from a moving boat, so they use
 * two different channels rather than competing for colour:
 *
 *   ring colour  -> which datasheet this point needs (on-reef or off-reef)
 *   fill         -> whether it has been sampled yet
 *
 * That way a sampled point still says which kind it was, and a crew scanning
 * for what is left sees hollow rings regardless of type.
 */
export const SURVEY_COLORS = {
  /** On-reef ring. The chart amber already used for "Modify". */
  on: "#e9a13b",
  /** Off-reef ring. The restoration-layer cyan. */
  off: "#4db6d0",
  /** Filled once a sample exists. The chart green already used for "Accept". */
  sampled: "#35b37e",
  /** Hollow centre: chart ink, so an unsampled point reads as an empty ring. */
  pending: "#0f1d26",
} as const;

export function toSurveyFeatureCollection(
  points: SurveyPoint[],
  samples: Map<string, SurveySample>,
) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point) => ({
      type: "Feature" as const,
      properties: {
        app_no: point.app_no,
        point_no: point.point_no,
        reef_type: point.reef_type,
        // MapLibre filters and paint expressions cannot look things up in a
        // Map, so the join happens here and rides along as a property.
        sampled: samples.has(pointKey(point.app_no, point.point_no)),
      },
      geometry: {
        type: "Point" as const,
        coordinates: [point.lon, point.lat],
      },
    })),
  };
}

/** Ring colour by reef type. */
export const reefRingColor = [
  "match",
  ["get", "reef_type"],
  "on",
  SURVEY_COLORS.on,
  "off",
  SURVEY_COLORS.off,
  SURVEY_COLORS.off,
];

/** Solid once sampled, hollow until then. */
export const sampledFillColor = [
  "case",
  ["get", "sampled"],
  SURVEY_COLORS.sampled,
  SURVEY_COLORS.pending,
];
