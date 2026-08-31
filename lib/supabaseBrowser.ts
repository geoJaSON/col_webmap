"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client — the app's single sign-in.
 *
 * One session covers everything: getting through the front door, reading
 * polling points as yourself, and recording ground samples under your name.
 * There used to be two doors — a shared site passcode, then a separate
 * Supabase sign-in buried in the Layers panel — which meant two passwords for
 * one app and a padlock icon nobody understood on a boat.
 *
 * This is `createBrowserClient` from @supabase/ssr rather than the plain
 * `createClient`, and that difference is load-bearing: it keeps the session in
 * *cookies* instead of localStorage, which is the only reason the middleware
 * can see whether someone is signed in before a page is ever rendered.
 * Swapping it back for `createClient` would silently lock everyone out.
 *
 * This is the *anon* key, public by design and safe in the bundle — every
 * table it can reach is governed by RLS. It is a different key, and a
 * different trust model, from the service-role key the API routes use.
 */
let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) client = createBrowserClient(url, key);
  return client;
}

/**
 * Whether sign-in can work at all on this deployment. The keys are read into
 * the bundle at build time, so a deploy missing them cannot be fixed by
 * setting them afterwards — it has to be rebuilt.
 */
export const authConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
