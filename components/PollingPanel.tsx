"use client";

import { SUBSTRATE_COLORS } from "@/lib/substrate";

/**
 * The season the layer draws. There is no picker: reviewers work against the
 * current season, and an unnoticed stale selection is worse than no choice at
 * all. Bump this when the platform rolls over to a new poll year.
 */
export const POLLING_YEAR = 2026;

type Props = {
  on: boolean;
  onToggle: () => void;
};

/**
 * "Polling points" — now just a toggle and its key.
 *
 * This used to carry its own email-and-password form, because the tile
 * function filters by who is asking and the app had no idea who that was. The
 * site-wide login made that redundant: by the time this renders, the person is
 * already signed in and their tiles already come back filtered to them.
 */
export default function PollingPanel({ on, onToggle }: Props) {
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
            style={{ "--swatch": "#e9a13b" } as React.CSSProperties}
            aria-hidden="true"
          />
          <span className="layers__label">Polling points</span>
        </button>
      </div>

      {on && (
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
        </div>
      )}
    </li>
  );
}
