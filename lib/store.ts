import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import seed from "@/data/applications.json";
import { type Application, type Status, isStatus } from "@/lib/types";

const TABLE = "col_applications";

/**
 * Supabase is optional at build/dev time. Without credentials the app still
 * runs -- it serves the polygons baked in from the workbook and reports itself
 * read-only, so `npm run dev` works on a fresh clone before anyone has set up a
 * project. `readOnly` is what the UI keys off to hide the status buttons.
 */
export type StoreMode = { readOnly: boolean; reason?: string };

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

export function storeMode(): StoreMode {
  if (!supabase()) {
    return {
      readOnly: true,
      reason: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to save changes.",
    };
  }
  return { readOnly: false };
}

function fromSeed(): Application[] {
  return (seed as unknown as Application[])
    .slice()
    .sort((a, b) => a.id - b.id);
}

export async function listApplications(): Promise<Application[]> {
  const db = supabase();
  if (!db) return fromSeed();

  const { data, error } = await db
    .from(TABLE)
    .select("id, group_name, status, applicant, bay_system, acreage, geometry")
    .order("id", { ascending: true });

  if (error) throw new Error(`Could not load applications: ${error.message}`);

  return (data ?? []).map((row) => ({
    ...row,
    // numeric() comes back as a string from PostgREST.
    acreage: row.acreage === null ? null : Number(row.acreage),
    status: isStatus(row.status) ? row.status : "Modify",
  })) as Application[];
}

/** Thrown when the application number does not exist, so the route can 404. */
export class ApplicationNotFound extends Error {
  constructor(id: number) {
    super(`Application ${id} is not in the list.`);
    this.name = "ApplicationNotFound";
  }
}

export async function updateStatus(id: number, status: Status): Promise<Application> {
  const db = supabase();
  if (!db) throw new Error("No database configured -- changes cannot be saved.");

  const { data, error } = await db
    .from(TABLE)
    .update({ status })
    .eq("id", id)
    .select("id, group_name, status, applicant, bay_system, acreage, geometry")
    .single();

  // PGRST116 is PostgREST's "expected one row, got none".
  if (error?.code === "PGRST116") throw new ApplicationNotFound(id);
  if (error) throw new Error(`Could not save application ${id}: ${error.message}`);
  if (!data) throw new ApplicationNotFound(id);

  return {
    ...data,
    acreage: data.acreage === null ? null : Number(data.acreage),
  } as Application;
}
