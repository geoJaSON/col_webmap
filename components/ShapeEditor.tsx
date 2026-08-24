"use client";

import { useMemo } from "react";

import { areaAcres, parseCoordinateText, validateRing, type Ring } from "@/lib/geometry";

type Props = {
  /** Open ring: the distinct corners, without the repeated closing point. */
  points: Ring;
  text: string;
  currentAcreage: number | null;
  saving: boolean;
  error: string | null;
  onTextChange: (text: string) => void;
  onRevert: () => void;
  onCancel: () => void;
  onSave: (ring: Ring, acres: number) => void;
};

export default function ShapeEditor({
  points,
  text,
  currentAcreage,
  saving,
  error,
  onTextChange,
  onRevert,
  onCancel,
  onSave,
}: Props) {
  // What the pasted text currently means, recomputed as you type so the
  // numbers under the box always describe what would be saved.
  const parsed = useMemo(() => parseCoordinateText(text), [text]);
  const checked = useMemo(
    () => (parsed.ok ? validateRing(parsed.points) : null),
    [parsed],
  );

  const acres = checked?.ok ? areaAcres(checked.ring) : null;
  const delta = acres !== null && currentAcreage !== null ? acres - currentAcreage : null;
  const problem = !parsed.ok ? parsed.error : checked && !checked.ok ? checked.error : null;
  const warnings = [
    ...(parsed.ok ? parsed.warnings : []),
    ...(checked?.ok ? checked.warnings : []),
  ];

  return (
    <div className="shape">
      <div className="shape__head">
        <span className="eyebrow">Corners</span>
        <span className="shape__hint">Drag on the map, or edit below</span>
      </div>

      <textarea
        className="shape__text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
        rows={7}
        aria-label="Corner coordinates, latitude and longitude per line"
        placeholder={"29.478027, -94.722220\n29.475650, -94.716110\n29.478800, -94.711480"}
      />

      <div className="shape__stats">
        <span className="num">{parsed.ok ? parsed.points.length : points.length} corners</span>
        <span className="num">
          {acres !== null ? `${acres.toFixed(2)} ac` : "—"}
          {delta !== null && Math.abs(delta) >= 0.005 && (
            <span className={delta < 0 ? "shape__delta shape__delta--down" : "shape__delta"}>
              {delta > 0 ? "+" : ""}
              {delta.toFixed(2)}
            </span>
          )}
        </span>
      </div>

      {problem && <p className="shape__problem">{problem}</p>}
      {warnings.map((w) => (
        <p className="shape__warning" key={w}>
          {w}
        </p>
      ))}

      <div className="shape__actions">
        <button type="button" className="shape__btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="shape__btn" onClick={onRevert} disabled={saving}>
          Reset
        </button>
        <button
          type="button"
          className="shape__btn shape__btn--save"
          disabled={saving || !checked?.ok}
          onClick={() => {
            if (checked?.ok && acres !== null) onSave(checked.ring, acres);
          }}
        >
          {saving ? "Saving…" : "Save shape"}
        </button>
      </div>
    </div>
  );
}
