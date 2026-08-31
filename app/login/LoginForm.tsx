"use client";

import { useState } from "react";

import { authConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

/**
 * Sign in with a CV Carbon account.
 *
 * There is no sign-up and no password reset here on purpose: accounts are
 * staff accounts on the wider platform, created and managed there. This page
 * is a door, not an account system.
 */
export default function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authConfigured()) {
    return (
      <p className="gate__error">
        Sign-in is not available on this deployment — NEXT_PUBLIC_SUPABASE_URL and
        NEXT_PUBLIC_SUPABASE_ANON_KEY were missing when it was built. They are read
        into the bundle at build time, so add them and deploy again without the
        build cache.
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const client = supabaseBrowser();
    if (!client) return;

    setBusy(true);
    setError(null);
    const { error: rejected } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (rejected) {
      setBusy(false);
      // Supabase says "Invalid login credentials" for both a wrong password
      // and an address with no account, and it is right not to distinguish
      // them. Pass it through rather than inventing a more specific claim.
      setError(rejected.message);
      return;
    }

    // A full navigation, not a router push: the session cookie was only just
    // written, and the middleware has to read it on a fresh request before any
    // gated page will render. Staying on the client would bounce straight back
    // here. `busy` is deliberately left on — the page is on its way out.
    window.location.href = next && next.startsWith("/") ? next : "/";
  };

  return (
    <form onSubmit={submit}>
      <label className="eyebrow gate__label" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        className="gate__input"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
        placeholder="you@cvcarbon.com"
        autoFocus
        required
      />

      <label className="eyebrow gate__label" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        className="gate__input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />

      {error && <p className="gate__error">{error}</p>}

      <button className="gate__submit" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
