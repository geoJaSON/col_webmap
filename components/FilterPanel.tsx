"use client";

import { useState } from "react";

import { STATUSES, STATUS_COLORS, type Filters, type Status } from "@/lib/types";

type Facet = { value: string; count: number };

type Props = {
  filters: Filters;
  statusCounts: Record<Status, number>;
  applicants: Facet[];
  bays: Facet[];
  groups: Facet[];
  activeCount: number;
  onToggle: (key: "statuses" | "applicants" | "bays" | "groups", value: string) => void;
  onReset: () => void;
};

function Group({
  title,
  count,
  children,
  startOpen = false,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className="filter-group" data-open={open}>
      <button
        type="button"
        className="filter-group__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="filter-group__caret" aria-hidden="true">
          ▶
        </span>
        <span className="eyebrow">{title}</span>
        {count > 0 && <span className="filter-group__count num">{count}</span>}
      </button>
      {open && <div className="filter-group__body">{children}</div>}
    </section>
  );
}

export default function FilterPanel({
  filters,
  statusCounts,
  applicants,
  bays,
  groups,
  activeCount,
  onToggle,
  onReset,
}: Props) {
  return (
    <div className="filters">
      <Group title="Status" count={filters.statuses.size} startOpen>
        <div className="chips">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className="chip"
              data-on={filters.statuses.has(status)}
              aria-pressed={filters.statuses.has(status)}
              style={
                filters.statuses.has(status) ? { color: STATUS_COLORS[status] } : undefined
              }
              onClick={() => onToggle("statuses", status)}
            >
              <span
                className="chip__swatch"
                style={{ background: STATUS_COLORS[status] }}
                aria-hidden="true"
              />
              {status}
              <span className="chip__n">{statusCounts[status]}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Owner" count={filters.applicants.size} startOpen>
        <div className="owners">
          {applicants.map((owner) => (
            <button
              key={owner.value}
              type="button"
              className="owner"
              data-on={filters.applicants.has(owner.value)}
              aria-pressed={filters.applicants.has(owner.value)}
              onClick={() => onToggle("applicants", owner.value)}
            >
              <span className="owner__box" aria-hidden="true" />
              <span className="owner__name" title={owner.value}>
                {owner.value}
              </span>
              <span className="owner__n">{owner.count}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Bay system" count={filters.bays.size}>
        <div className="chips">
          {bays.map((bay) => (
            <button
              key={bay.value}
              type="button"
              className="chip"
              data-on={filters.bays.has(bay.value)}
              aria-pressed={filters.bays.has(bay.value)}
              onClick={() => onToggle("bays", bay.value)}
            >
              {bay.value}
              <span className="chip__n">{bay.count}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Reviewer" count={filters.groups.size}>
        <div className="chips">
          {groups.map((group) => (
            <button
              key={group.value}
              type="button"
              className="chip"
              data-on={filters.groups.has(group.value)}
              aria-pressed={filters.groups.has(group.value)}
              onClick={() => onToggle("groups", group.value)}
            >
              {group.value}
              <span className="chip__n">{group.count}</span>
            </button>
          ))}
        </div>
      </Group>

      {activeCount > 0 && (
        <button type="button" className="filter-reset" onClick={onReset}>
          Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
