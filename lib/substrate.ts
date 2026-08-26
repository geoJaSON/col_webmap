/**
 * Polling-point symbology, copied from the platform's field map and mobile app
 * so a point means the same thing here as it does there. Do not re-pick these
 * colours: people read them by eye across three apps.
 */
export const SUBSTRATE_COLORS: Record<string, string> = {
  "Solid Reef": "#31AD41",
  "Scattered Shell": "#F79F40",
  Mud: "#BD7EBE",
  "Firm/Hard Bottom": "#FFF15C",
  "Buried Shell": "#B2E061",
  Sand: "#FF0000",
  "Too Deep to Poll": "#000000",
};

/** Anything unrecognised, including nulls, reads as neutral grey. */
export const SUBSTRATE_FALLBACK = "#9E9E9E";

/** MapLibre `match` expression over the substrate property. */
export function substrateColorExpression() {
  const stops: (string | string[])[] = [];
  for (const [label, color] of Object.entries(SUBSTRATE_COLORS)) {
    stops.push(label, color);
  }
  return ["match", ["get", "substrate"], ...stops, SUBSTRATE_FALLBACK];
}
