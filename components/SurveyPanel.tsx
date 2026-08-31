"use client";

import { useState } from "react";

import { pollingConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { SURVEY_COLORS } from "@/lib/surveyStyle";

type Props = {
  on: boolean;
  email: string | null;
  loading: boolean;
  error: string | null;
  progress: { sampled: number; total: number };
  onToggle: () => void;
  onSignedIn: (userId: string, email: string | null) => void;
  onSignOut: () => void;
};

/**
 * "Ground samples" plus the sign-in it needs and the progress it reports.
 *
 * Laid out like the polling entry beside it because it is the same kind of
 * thing -- a layer that only means anything once the platform knows who is
 * asking. It shares the browser Supabase client with that panel, so signing in
 * on either one satisfies both.
 */
export default function SurveyPanel({
  on,
  email,
  loading,
  error,
  progress,
  onToggle,
  onSignedIn,
  onSignOut,
}: Props) {
  const [asking, setAsking] = useState(false);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!pollingConfigured()) {
    return (
      <li className="layers__item">
        <div className="layers__head">
          <span className="layers__row" data-on={false}>
            <span
              className="layers__swatch"
              style={{ "--swatch": SURVEY_COLORS.on } as React.CSSProperties}
              aria-hidden="true"
            />
            <span className="layers__label">Ground samples</span>
          </span>
        </div>
        <p className="polling__note">
          Not available on this deployment — NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY were missing when it was built.
        </p>
      </li>
    );
  }

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const client = supabaseBrowser();
    if (!client) return;
    setBusy(true);
    setFailure(null);
    const { data, error: rejected } = await client.auth.signInWithPassword({
      email: address.trim(),
      password,
    });
    setBusy(false);
    if (rejected) {
      setFailure(rejected.message);
      return;
    }
    setPassword("");
    setAsking(false);
    if (data.session) onSignedIn(data.session.user.id, data.session.user.email ?? null);
  };

  const handleToggle = () => {
    // Turning it on without a session would draw an empty layer and look like
    // there was nothing assigned. Ask instead.
    if (!email && !on) {
      setAsking(true);
      return;
    }
    onToggle();
  };

  const pct =
    progress.total > 0 ? Math.round((progress.sampled / progress.total) * 100) : 0;

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
            style={{ "--swatch": SURVEY_COLORS.on } as React.CSSProperties}
            aria-hidden="true"
          />
          <span className="layers__label">Ground samples</span>
          {!email && <span className="layers__lock" aria-hidden="true">🔒</span>}
        </button>
      </div>

      {asking && !email && (
        <form className="signin" onSubmit={signIn}>
          <p className="signin__blurb">Sign in to record ground samples.</p>
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
          {failure && <p className="signin__error">{failure}</p>}
          <div className="signin__actions">
            <button
              type="button"
              className="shape__btn"
              onClick={() => {
                setAsking(false);
                setFailure(null);
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
          {loading && <p className="polling__note">Loading the assignment…</p>}
          {error && <p className="signin__error">{error}</p>}

          {!loading && !error && progress.total > 0 && (
            <>
              {/* The number that actually matters on a survey day. */}
              <p className="survey-progress">
                <span className="num">{progress.sampled}</span> of{" "}
                <span className="num">{progress.total}</span> sampled
                <span className="survey-progress__pct num">{pct}%</span>
              </p>
              <div
                className="survey-bar"
                role="progressbar"
                aria-valuenow={progress.sampled}
                aria-valuemin={0}
                aria-valuemax={progress.total}
              >
                <span className="survey-bar__fill" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}

          <ul className="legend">
            <li className="legend__item">
              <span
                className="legend__ring"
                style={{ borderColor: SURVEY_COLORS.on }}
                aria-hidden="true"
              />
              On reef
            </li>
            <li className="legend__item">
              <span
                className="legend__ring"
                style={{ borderColor: SURVEY_COLORS.off }}
                aria-hidden="true"
              />
              Off reef
            </li>
            <li className="legend__item">
              <span
                className="legend__dot"
                style={{ background: SURVEY_COLORS.sampled }}
                aria-hidden="true"
              />
              Sampled
            </li>
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
