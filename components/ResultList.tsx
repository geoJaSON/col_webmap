"use client";

import { useEffect, useRef } from "react";

import { STATUS_COLORS, type Application } from "@/lib/types";

type Props = {
  applications: Application[];
  totalAcres: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onReset: () => void;
  filtered: boolean;
  /** Link to the CSV for exactly the rows listed below. */
  exportHref: string;
};

export default function ResultList({
  applications,
  totalAcres,
  selectedId,
  onSelect,
  onReset,
  filtered,
  exportHref,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected row in view when the selection came from the map or the
  // ledger rather than from the list itself.
  useEffect(() => {
    if (selectedId === null || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (applications.length === 0) {
    return (
      <div className="empty">
        <p className="empty__line">No applications match these filters.</p>
        <button type="button" className="empty__action" onClick={onReset}>
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="results-head">
        <span className="eyebrow">
          {applications.length} {filtered ? "matching" : "applications"}
        </span>
        <span className="results-head__acres">{totalAcres.toFixed(1)} ac</span>
        {/* A plain link, so the browser handles the download and the file name
            comes from the server rather than being guessed here. */}
        <a
          className="results-head__export"
          href={exportHref}
          download
          title={
            filtered
              ? `Download these ${applications.length} as CSV`
              : "Download all applications as CSV"
          }
        >
          CSV
        </a>
      </div>
      <div ref={listRef}>
        {applications.map((app) => (
          <button
            key={app.id}
            type="button"
            className="row"
            data-id={app.id}
            data-selected={selectedId === app.id}
            onClick={() => onSelect(app.id)}
          >
            <span
              className="row__bar"
              style={{ background: STATUS_COLORS[app.status] }}
              aria-hidden="true"
            />
            <span className="row__id">{app.id}</span>
            <span className="row__body">
              <span className="row__applicant">{app.applicant}</span>
              <span className="row__meta">
                {app.status} · {app.bay_system.replace(" Bay", "")} · {app.group_name}
              </span>
            </span>
            <span className="row__acres">{app.acreage?.toFixed(1) ?? "—"}</span>
          </button>
        ))}
      </div>
    </>
  );
}
