"use client";

import { useEffect, useState } from "react";

import { pollingConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { SUBSTRATE_COLORS } from "@/lib/substrate";

/**
 * The season the layer draws. There is no picker: reviewers work against the
 * current season, and an unnoticed stale selection is worse than no choice at
 * all. Bump this when the platform rolls over to a new poll year.
 */
export const POLLING_YEAR = 2026;

type Props = {
  on: boolean;
  email: string | null;
  onToggle: () => void;
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
  email,
  onToggle,
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
          {/* The palette only means something with the key next to it, and a
              permanent legend bar would be seven swatches of clutter when the
              layer is off. */}
          <ul className="legend">
            {Object.entries(SUBSTRATE_COLORS).map(([label, color]) => (
              <li className="legend__item" key={label}>
                <span className="legend__dot" style={{ background: color }} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>

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
