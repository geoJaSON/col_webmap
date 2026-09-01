"use client";

import { useRef, useState } from "react";

import { fromCuts, type ShareKey, type Shares } from "@/lib/sediment";

/**
 * Sediment composition as one proportional bar with two draggable dividers.
 *
 * The point of the shape is that it cannot express a wrong answer. The state
 * is not three numbers that have to be kept in agreement -- it is two cut
 * points on a bar, and mud/sand/shell-hash are read off as the widths between
 * them. Three values summing to 100 is the only thing this control *can*
 * produce, so the "must total 100%" failure the datasheet invites is gone by
 * construction rather than caught after the fact.
 *
 * The CHECK constraint in survey_schema.sql and the check in validateDraft
 * both stay regardless. This makes the error unreachable through the UI; they
 * are what make it impossible.
 *
 * Dragging snaps to 5% because that is roughly the precision of the underlying
 * act -- someone eyeballing the contents of a dredge is not distinguishing 47%
 * from 48% mud.
 */

/** Drag and arrow-key granularity. Shift-arrow gives single points. */
const SNAP = 5;

/** Below this width a segment has no room for its label; the key below has it. */
const LABEL_MIN_PCT = 14;

/**
 * Where the dividers sit before anyone has touched them. This is a starting
 * position to drag from, *not* an answer: until the bar is moved these values
 * are shown dimmed and nothing is written to the draft. An untouched sample
 * must not come out carrying a plausible-looking composition that nobody
 * actually entered.
 */
const START: Shares = { mud: 34, sand: 33, shellHash: 33 };

const COLORS = {
  mud: "#8d6e5c",
  sand: "#d9c188",
  shellHash: "#b9c7cc",
} as const;

type Key = ShareKey;

const FIELDS: { key: Key; label: string; short: string }[] = [
  { key: "mud", label: "Mud", short: "Mud" },
  { key: "sand", label: "Sand", short: "Sand" },
  { key: "shellHash", label: "Shell hash", short: "Shell" },
];

type Props = {
  mud: string;
  sand: string;
  shellHash: string;
  /** Always called with all three at once, always totalling 100. */
  onChange: (mud: string, sand: string, shellHash: string) => void;
};

export default function SedimentBar({ mud, sand, shellHash, onChange }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);

  // Empty means nobody has answered yet. The bar still draws — it is live and
  // draggable from the first touch — but it draws dimmed and the draft keeps
  // its empty values, so validateDraft still treats the question as open.
  const isSet = mud !== "" && sand !== "" && shellHash !== "";

  const values: Shares = isSet
    ? { mud: Number(mud) || 0, sand: Number(sand) || 0, shellHash: Number(shellHash) || 0 }
    : START;

  const cut1 = values.mud;
  const cut2 = values.mud + values.sand;

  const emitCuts = (a: number, b: number) => {
    const next = fromCuts(a, b);
    onChange(String(next.mud), String(next.sand), String(next.shellHash));
  };

  const pctFromClientX = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    return Math.round(raw / SNAP) * SNAP;
  };

  /**
   * A divider dragged past its neighbour pushes it along rather than stopping
   * dead, so mud can be taken to 100 in one gesture instead of two.
   */
  const moveTo = (which: 1 | 2, pct: number) => {
    if (which === 1) emitCuts(pct, Math.max(cut2, pct));
    else emitCuts(Math.min(cut1, pct), pct);
  };

  const startDrag = (which: 1 | 2) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(which);
    // Touching a divider on an untouched bar is itself the answer: it commits
    // the starting split, so a crew happy with an even mix does not have to
    // nudge it away and back to register one.
    if (!isSet) emitCuts(cut1, cut2);
  };

  const onDrag = (which: 1 | 2) => (event: React.PointerEvent) => {
    if (dragging !== which) return;
    moveTo(which, pctFromClientX(event.clientX));
  };

  const endDrag = (event: React.PointerEvent) => {
    // pointercancel and pointerup can both arrive for one gesture, and
    // releasing a capture that is no longer held throws InvalidPointerId.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  };

  const onKey = (which: 1 | 2) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 1 : SNAP;
    const at = which === 1 ? cut1 : cut2;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(which, at - step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(which, at + step);
    } else if (event.key === "Enter" || event.key === " ") {
      // The keyboard equivalent of touching a divider: accept where it sits.
      event.preventDefault();
      emitCuts(cut1, cut2);
    }
  };

  return (
    <div className="sediment" data-set={isSet}>
      <div className="sediment__bar" ref={bar} data-dragging={dragging !== null}>
        {FIELDS.map(({ key, short }) => (
          <div
            key={key}
            className="sediment__seg"
            style={{ width: `${values[key]}%`, background: COLORS[key] }}
          >
            {values[key] >= LABEL_MIN_PCT && (
              <span className="sediment__segtext">
                <span className="sediment__segname">{short}</span>
                <span className="num">{values[key]}%</span>
              </span>
            )}
          </div>
        ))}

        {([1, 2] as const).map((which) => {
          const at = which === 1 ? cut1 : cut2;
          const label = which === 1 ? "Mud / sand boundary" : "Sand / shell hash boundary";
          return (
            <div
              key={which}
              className="sediment__handle"
              style={{ left: `${at}%` }}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={at}
              aria-valuetext={`${at}%`}
              onPointerDown={startDrag(which)}
              onPointerMove={onDrag(which)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKey(which)}
            >
              <span className="sediment__grip" aria-hidden="true" />
            </div>
          );
        })}
      </div>

      {/* A segment narrower than LABEL_MIN_PCT has no room for its own number,
          so the key carries all three regardless of how thin a share gets. */}
      {isSet ? (
        <ul className="sediment__key">
          {FIELDS.map(({ key, label }) => (
            <li className="sediment__keyitem" key={key}>
              <span
                className="sediment__swatch"
                style={{ background: COLORS[key] }}
                aria-hidden="true"
              />
              {label} <span className="num">{values[key]}%</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sediment__hint">Drag a divider to set the composition.</p>
      )}
    </div>
  );
}
