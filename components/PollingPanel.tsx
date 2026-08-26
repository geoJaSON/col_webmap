"use client";

import { useEffect, useState } from "react";

import { pollingConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

/** Years with polling data in the platform, newest first. */
export const POLLING_YEARS = [2026, 2025, 2024, 2023];

type Props = {
  on: boolean;
  year: number;
  email: string | null;
  onToggle: () => void;
  onYearChange: (year: number) => void;
  onSignedIn: (token: string, email: string | null) => void;
  onSignOut: () => void;
};

/**
 * "Show polling points" plus the sign-in it needs.
 *
 * The points belong to the wider platform and the tile function filters them
 * by who is asking, so signing in is not decoration — signed out, every tile
 * comes back empty.
 */
export default function PollingPanel({
  on,
  year,
  email,
  onToggle,
  onYearChange,
  onSignedIn,
  onSignOut,
}: Props) {
  const [asking, setAsking] = useState(false);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = pollingConfigured();

  // Pick up an existing session so a return visit does not ask again.
  useEffect(() => {
    const client = supabaseBrowser();
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        onSignedIn(data.session.access_token, data.session.user.email ?? null);
      }
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) onSignedIn(session.access_token, session.user.email ?? null);
      else onSignOut();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vanishing when the keys are absent makes a misconfigured deploy look
  // identical to a working one with nothing to show. Say so instead.
  if (!configured) {
    return (
      <li className="layers__item">
        <div className="layers__head">
          <span className="layers__row" data-on={false}>
            <span
              className="layers__swatch"
              style={{ "--swatch": "#e9a13b" } as React.CSSProperties}
              aria-hidden="true"
            />
            <span className="layers__label">Polling points</span>
          </span>
        </div>
        <p className="polling__note">
          Not available on this deployment — NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY were missing when it was built. They are
          read into the bundle at build time, so add them and deploy again
          without the build cache.
        </p>
      </li>
    );
  }

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const client = supabaseBrowser();
    if (!client) return;
    setBusy(true);
    setError(null);
    const { data, error: failure } = await client.auth.signInWithPassword({
      email: address.trim(),
      password,
    });
    setBusy(false);
    if (failure) {
      setError(failure.message);
      return;
    }
    setPassword("");
    setAsking(false);
    if (data.session) onSignedIn(data.session.access_token, data.session.user.email ?? null);
  };

  const handleToggle = () => {
    if (!email && !on) {
      // Turning it on without a session: ask for one rather than silently
      // drawing an empty layer.
      setAsking(true);
      return;
    }
    onToggle();
  };

  return (
    <li className="layers__item">
      <div className="layers__head">
        <button
          type="button"
          className="layers__row"
          data-on={on}
          aria-pressed={on}
          onClick={handleToggle}
        >
          <span
            className="layers__swatch"
            style={{ "--swatch": "#e9a13b" } as React.CSSProperties}
            aria-hidden="true"
          />
          <span className="layers__label">Polling points</span>
          {!email && <span className="layers__lock" aria-hidden="true">🔒</span>}
        </button>
      </div>

      {asking && !email && (
        <form className="signin" onSubmit={signIn}>
          <p className="signin__blurb">Sign in to the platform to see polling points.</p>
          <input
            className="signin__input"
            type="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            required
            autoFocus
          />
          <input
            className="signin__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          {error && <p className="signin__error">{error}</p>}
          <div className="signin__actions">
            <button
              type="button"
              className="shape__btn"
              onClick={() => {
                setAsking(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="shape__btn shape__btn--save" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      )}

      {on && email && (
        <div className="polling">
          <label className="polling__row" htmlFor="polling-year">
            <span className="eyebrow">Season</span>
            <select
              id="polling-year"
              className="polling__year"
              value={year}
              onChange={(e) => onYearChange(Number(e.target.value))}
            >
              {POLLING_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <p className="polling__who">
            {email}
            <button
              type="button"
              className="polling__signout"
              onClick={async () => {
                await supabaseBrowser()?.auth.signOut();
                onSignOut();
              }}
            >
              Sign out
            </button>
          </p>
        </div>
      )}
    </li>
  );
}
