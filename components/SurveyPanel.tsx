"use client";

import { SURVEY_COLORS } from "@/lib/surveyStyle";

type Props = {
  on: boolean;
  loading: boolean;
  error: string | null;
  progress: { sampled: number; total: number };
  onToggle: () => void;
};

/**
 * "Ground samples" — the layer toggle, how far along the survey is, and the key.
 *
 * Like the polling entry beside it, this used to carry its own sign-in form.
 * The site-wide login removed the need: anyone looking at this is already
 * signed in, so samples are already attributable and the layer can just be a
 * layer.
 */
export default function SurveyPanel({ on, loading, error, progress, onToggle }: Props) {
  const pct = progress.total > 0 ? Math.round((progress.sampled / progress.total) * 100) : 0;

  return (
    <li className="layers__item">
      <div className="layers__head">
        <button
          type="button"
          className="layers__row"
          data-on={on}
          aria-pressed={on}
          onClick={onToggle}
        >
          <span
            className="layers__swatch"
            style={{ "--swatch": SURVEY_COLORS.on } as React.CSSProperties}
            aria-hidden="true"
          />
          <span className="layers__label">Ground samples</span>
        </button>
      </div>

      {on && (
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
        </div>
      )}
    </li>
  );
}
