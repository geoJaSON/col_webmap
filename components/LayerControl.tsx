"use client";

import { useState } from "react";

import type { LayerCategory } from "@/lib/layers";

type Props = {
  categories: LayerCategory[];
  active: Set<string>;
  bufferFeet: Record<string, number>;
  /** Below this zoom a buffer is sub-pixel, so it is not drawn or computed. */
  buffersVisible: boolean;
  onToggle: (id: string) => void;
  onBufferChange: (id: string, feet: number) => void;
  onZoomTo: (category: LayerCategory) => void;
};

const MAX_FEET = 2000;
const STEP_FEET = 50;

export default function LayerControl({
  categories,
  active,
  bufferFeet,
  buffersVisible,
  onToggle,
  onBufferChange,
  onZoomTo,
}: Props) {
  const [open, setOpen] = useState(false);
  if (categories.length === 0) return null;

  return (
    <div className="layers" data-open={open}>
      <button
        type="button"
        className="layers__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Layers
        <span className="layers__count num">
          {active.size}/{categories.length}
        </span>
      </button>

      {open && (
        <ul className="layers__list">
          {categories.map((category) => {
            const on = active.has(category.id);
            const feet = bufferFeet[category.id] ?? category.bufferFeet;
            return (
              <li className="layers__item" key={category.id}>
                <div className="layers__head">
                  <button
                    type="button"
                    className="layers__row"
                    data-on={on}
                    aria-pressed={on}
                    onClick={() => onToggle(category.id)}
                  >
                    <span
                      className="layers__swatch"
                      style={{ "--swatch": category.color } as React.CSSProperties}
                      aria-hidden="true"
                    />
                    <span className="layers__label">{category.label}</span>
                    <span className="layers__n num">{category.features}</span>
                  </button>
                  <button
                    type="button"
                    className="layers__zoom"
                    title={`Zoom to all ${category.label.toLowerCase()}s`}
                    aria-label={`Zoom to ${category.label}`}
                    onClick={() => onZoomTo(category)}
                  >
                    ⤢
                  </button>
                </div>

                {on && (
                  <div className="buffer">
                    <label className="buffer__label" htmlFor={`buffer-${category.id}`}>
                      <span className="eyebrow">Buffer</span>
                      <span className="buffer__value num">
                        {feet === 0 ? "off" : `${feet} ft`}
                      </span>
                    </label>
                    <input
                      id={`buffer-${category.id}`}
                      className="buffer__slider"
                      type="range"
                      min={0}
                      max={MAX_FEET}
                      step={STEP_FEET}
                      value={feet}
                      style={{ "--swatch": category.color } as React.CSSProperties}
                      onChange={(e) => onBufferChange(category.id, Number(e.target.value))}
                    />
                    {feet > 0 && !buffersVisible && (
                      <p className="buffer__note">Zoom in to see the buffer.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
