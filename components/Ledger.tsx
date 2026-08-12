"use client";

import { STATUS_COLORS, type Application } from "@/lib/types";

type Props = {
  applications: Application[];
  visible: Set<number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
};

/**
 * Every application as one tick, in TPWD application order. Width tracks
 * acreage, colour tracks status, and ticks outside the current filter fade
 * back. Reads as the whole caseload at a glance and doubles as a jump-to.
 */
export default function Ledger({ applications, visible, selectedId, onSelect }: Props) {
  return (
    <div className="ledger" role="group" aria-label="All applications by acreage">
      {applications.map((app) => (
        <button
          key={app.id}
          type="button"
          className="ledger__tick"
          style={{
            flexGrow: Math.max(app.acreage ?? 1, 6),
            background: STATUS_COLORS[app.status],
          }}
          data-visible={visible.has(app.id)}
          data-selected={selectedId === app.id}
          title={`${app.id} · ${app.applicant} · ${app.status} · ${app.acreage ?? "?"} ac`}
          aria-label={`Application ${app.id}, ${app.applicant}, ${app.status}, ${app.acreage ?? "unknown"} acres`}
          onClick={() => onSelect(app.id)}
        />
      ))}
    </div>
  );
}
