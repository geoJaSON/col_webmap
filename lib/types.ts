export const STATUSES = ["Accept", "Modify", "Decline"] as const;

export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export type Application = {
  /** TPWD Application # */
  id: number;
  /** Reviewer group: "Justin" or "Johny" */
  group_name: string;
  status: Status;
  applicant: string;
  bay_system: string;
  acreage: number | null;
  /** GeoJSON Polygon */
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
};

export type Filters = {
  statuses: Set<Status>;
  applicants: Set<string>;
  bays: Set<string>;
  groups: Set<string>;
  search: string;
};

export const STATUS_COLORS: Record<Status, string> = {
  Accept: "#35B37E",
  Modify: "#E9A13B",
  Decline: "#E2564F",
};
