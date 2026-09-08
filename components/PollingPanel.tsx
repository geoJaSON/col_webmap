"use client";

import { SUBSTRATE_COLORS } from "@/lib/substrate";
import type { SnapshotState } from "@/lib/pollingSnapshot";

type Props = {
  on: boolean;
  snapshot: SnapshotState;
  onToggle: () => void;
};

/** A dated snapshot shared by everyone who can sign in to this map. */
export default function PollingPanel({ on, snapshot, onToggle }: Props) {
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
          <span className="layers__label">Polling snapshot</span>
        </button>
      </div>

      {on && (
        <div className="polling">
          {snapshot.metadata && (
            <p className="polling__snapshot">
              {snapshot.metadata.features.toLocaleString()} points · {snapshot.metadata.createdAt.slice(0, 10)}
              <br />Open water in COL bays + points inside COLs.
            </p>
          )}
          {snapshot.loading && <p className="polling__snapshot" role="status">Loading polling points…</p>}
          {snapshot.error && <p className="polling__snapshot" role="alert">{snapshot.error}</p>}
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
