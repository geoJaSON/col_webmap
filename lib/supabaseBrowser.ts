"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client, used for one thing only: signing a person in
 * so their own polling points can be read as them.
 *
 * This is the *anon* key, which is public by design and safe in the bundle —
 * every table it can reach is governed by RLS. It is a different key, and a
 * different trust model, from the service-role key the API routes use for the
 * COL table.
 */
let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "col-polling-auth",
      },
    });
  }
  return client;
}

export const pollingConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
