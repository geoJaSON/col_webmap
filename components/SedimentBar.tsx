"use client";

import { useRef, useState } from "react";

import { fromCuts, rebalance, type ShareKey, type Shares } from "@/lib/sediment";

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
 * from 48% mud. The number boxes underneath take any whole number for the rare
 * case that wants one.
 */

/** Drag and arrow-key granularity. Shift-arrow gives single points. */
const SNAP = 5;

/** Below this width a segment has no room for its label; the readout has it. */
const LABEL_MIN_PCT = 14;

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
  /**
   * The box being typed in, held raw so the other two do not rebalance on
   * every keystroke -- watching the neighbours jump while you type "75" is
   * horrible. They settle when the field is left.
   */
  const [typing, setTyping] = useState<{ key: Key; value: string } | null>(null);

  // Empty means nobody has answered yet, and that has to stay visible: a bar
  // pre-filled with a plausible split is an answer the crew never gave.
  const isSet = mud !== "" && sand !== "" && shellHash !== "";

  const values: Shares = {
    mud: Number(mud) || 0,
    sand: Number(sand) || 0,
    shellHash: Number(shellHash) || 0,
  };

  const cut1 = values.mud;
  const cut2 = values.mud + values.sand;

  const emit = (next: Shares) =>
    onChange(String(next.mud), String(next.sand), String(next.shellHash));

  const emitCuts = (a: number, b: number) => emit(fromCuts(a, b));

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
    }
  };

  /**
   * Typing one number leaves 100 minus it to share out. The other two keep
   * their ratio to each other, so setting mud to 75 does not silently decide
   * that the rest is all sand.
   */
  const commitTyped = (key: Key, text: string) => {
    setTyping(null);
    if (text.trim() === "") return;

    emit(rebalance(values, key, Number(text) || 0));
  };

  if (!isSet) {
    return (
      <div className="sediment">
        <button
          type="button"
          className="sediment__seed"
          // An even split is a starting position, not an answer -- it only
          // appears once someone has deliberately asked for the control.
          onClick={() => onChange("34", "33", "33")}
        >
          <span className="sediment__seedlabel">Tap to set composition</span>
        </button>
      </div>
    );
  }

  const widths: Shares = values;

  return (
    <div className="sediment">
      <div className="sediment__bar" ref={bar} data-dragging={dragging !== null}>
        {FIELDS.map(({ key, short }) => (
          <div
            key={key}
            className="sediment__seg"
            style={{ width: `${widths[key]}%`, background: COLORS[key] }}
          >
            {widths[key] >= LABEL_MIN_PCT && (
              <span className="sediment__segtext">
                <span className="sediment__segname">{short}</span>
                <span className="num">{widths[key]}%</span>
              </span>
            )}
          </div>
        ))}

        {([1, 2] as const).map((which) => {
          const at = which === 1 ? cut1 : cut2;
          const label =
            which === 1 ? "Mud / sand boundary" : "Sand / shell hash boundary";
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

      <div className="sediment__readout">
        {FIELDS.map(({ key, label }) => (
          <label className="sediment__field" key={key}>
            <span className="sediment__swatch" style={{ background: COLORS[key] }} aria-hidden="true" />
            <span className="sediment__name">{label}</span>
            <input
              className="sediment__input num"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={typing?.key === key ? typing.value : String(values[key])}
              onChange={(e) =>
                setTyping({ key, value: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })
              }
              onFocus={(e) => {
                setTyping({ key, value: String(values[key]) });
                e.target.select();
              }}
              onBlur={(e) => commitTyped(key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              aria-label={`${label} percentage`}
            />
            <span className="sediment__pct">%</span>
          </label>
        ))}
      </div>
    </div>
  );
}
