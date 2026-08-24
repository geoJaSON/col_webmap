"use client";

import { useState } from "react";

import type { LayerMeta } from "@/lib/layers";

type Props = {
  layers: LayerMeta[];
  active: Set<string>;
  onToggle: (id: string) => void;
  onZoomTo: (layer: LayerMeta) => void;
};

export default function LayerControl({ layers, active, onToggle, onZoomTo }: Props) {
  const [open, setOpen] = useState(false);
  if (layers.length === 0) return null;

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
          {active.size}/{layers.length}
        </span>
      </button>

      {open && (
        <ul className="layers__list">
          {layers.map((layer) => (
            <li className="layers__item" key={layer.id}>
              <button
                type="button"
                className="layers__row"
                data-on={active.has(layer.id)}
                aria-pressed={active.has(layer.id)}
                onClick={() => onToggle(layer.id)}
              >
                {/* The colour rides in on a custom property so the
                    stylesheet can decide filled vs hollow. */}
                <span
                  className="layers__swatch"
                  style={{ "--swatch": layer.color } as React.CSSProperties}
                  aria-hidden="true"
                />
                <span className="layers__label">{layer.label}</span>
              </button>
              <button
                type="button"
                className="layers__zoom"
                title={`Zoom to ${layer.label}`}
                aria-label={`Zoom to ${layer.label}`}
                onClick={() => onZoomTo(layer)}
              >
                ⤢
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
