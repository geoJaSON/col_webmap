"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DetailCard from "@/components/DetailCard";
import FilterPanel from "@/components/FilterPanel";
import Ledger from "@/components/Ledger";
import MapCanvas from "@/components/MapCanvas";
import ResultList from "@/components/ResultList";
import type { StoreMode } from "@/lib/store";
import { STATUSES, type Application, type Filters, type Status } from "@/lib/types";

const PASSCODE_KEY = "col-edit-passcode";

const emptyFilters = (): Filters => ({
  statuses: new Set<Status>(),
  applicants: new Set<string>(),
  bays: new Set<string>(),
  groups: new Set<string>(),
  search: "",
});

function countBy(applications: Application[], key: keyof Application) {
  const counts = new Map<string, number>();
  for (const app of applications) {
    const value = String(app[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

type Props = {
  initialApplications: Application[];
  mode: StoreMode;
};

export default function Workspace({ initialApplications, mode }: Props) {
  const [applications, setApplications] = useState(initialApplications);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcodeRequired, setPasscodeRequired] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setPasscodeRequired(Boolean(c.passcodeRequired)))
      .catch(() => setPasscodeRequired(false));
  }, []);

  const facets = useMemo(
    () => ({
      applicants: countBy(applications, "applicant"),
      bays: countBy(applications, "bay_system"),
      groups: countBy(applications, "group_name"),
    }),
    [applications],
  );

  const statusCounts = useMemo(() => {
    const counts = { Accept: 0, Modify: 0, Decline: 0 } as Record<Status, number>;
    for (const app of applications) counts[app.status] += 1;
    return counts;
  }, [applications]);

  const visible = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return applications.filter((app) => {
      if (filters.statuses.size && !filters.statuses.has(app.status)) return false;
      if (filters.applicants.size && !filters.applicants.has(app.applicant)) return false;
      if (filters.bays.size && !filters.bays.has(app.bay_system)) return false;
      if (filters.groups.size && !filters.groups.has(app.group_name)) return false;
      if (!needle) return true;
      return (
        String(app.id).startsWith(needle) ||
        app.applicant.toLowerCase().includes(needle) ||
        app.bay_system.toLowerCase().includes(needle) ||
        app.group_name.toLowerCase().includes(needle)
      );
    });
  }, [applications, filters]);

  const visibleIds = useMemo(() => visible.map((a) => a.id), [visible]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const totalAcres = useMemo(
    () => visible.reduce((sum, a) => sum + (a.acreage ?? 0), 0),
    [visible],
  );

  const activeCount =
    filters.statuses.size +
    filters.applicants.size +
    filters.bays.size +
    filters.groups.size +
    (filters.search.trim() ? 1 : 0);

  const selected = useMemo(
    () => applications.find((a) => a.id === selectedId) ?? null,
    [applications, selectedId],
  );

  const toggle = useCallback(
    (key: "statuses" | "applicants" | "bays" | "groups", value: string) => {
      setFilters((prev) => {
        const next = new Set(prev[key] as Set<string>);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return { ...prev, [key]: next } as Filters;
      });
    },
    [],
  );

  const reset = useCallback(() => setFilters(emptyFilters()), []);

  const select = useCallback((id: number | null) => {
    setSelectedId(id);
    setError(null);
    // On a phone the sheet covers the map, so drop it back to the peek height
    // to reveal the lease that was just picked.
    if (id !== null) setSheetOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drop a selection the filters have just hidden -- otherwise the detail card
  // keeps offering to edit a lease that is no longer anywhere on screen.
  useEffect(() => {
    if (selectedId !== null && !visibleIdSet.has(selectedId)) setSelectedId(null);
  }, [selectedId, visibleIdSet]);

  const setStatus = useCallback(
    async (id: number, status: Status) => {
      const previous = applications.find((a) => a.id === id);
      if (!previous || previous.status === status) return;

      setError(null);
      setSaving(true);
      // Optimistic: the map recolours the moment the button is pressed.
      setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (passcodeRequired) {
        let code = window.localStorage.getItem(PASSCODE_KEY);
        if (!code) {
          code = window.prompt("Passcode to change a status") ?? "";
          if (code) window.localStorage.setItem(PASSCODE_KEY, code);
        }
        headers["x-edit-passcode"] = code;
      }

      try {
        const response = await fetch(`/api/applications/${id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status }),
        });
        if (!response.ok) {
          if (response.status === 401) window.localStorage.removeItem(PASSCODE_KEY);
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? `Save failed (${response.status}).`);
        }
      } catch (cause) {
        // Put the old status back so the map never shows a value the database
        // does not hold.
        setApplications((prev) => prev.map((a) => (a.id === id ? previous : a)));
        setError(cause instanceof Error ? cause.message : "Save failed.");
      } finally {
        setSaving(false);
      }
    },
    [applications, passcodeRequired],
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead__mark">
          <h1 className="masthead__title">COL Status</h1>
          <span className="masthead__sub">
            {applications.length} applications ·{" "}
            {STATUSES.map((s) => `${statusCounts[s]} ${s.toLowerCase()}`).join(" · ")}
          </span>
        </div>
        <Ledger
          applications={applications}
          visible={visibleIdSet}
          selectedId={selectedId}
          onSelect={select}
        />
        {saving && <span className="masthead__saving">Saving…</span>}
      </header>

      <aside className="panel" data-open={sheetOpen}>
        <button
          type="button"
          className="sheet-toggle"
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
        >
          <span className="sheet-toggle__grip" aria-hidden="true" />
          <span className="sheet-toggle__count">{visible.length}</span>
          <span className="eyebrow">{activeCount > 0 ? "matching" : "applications"}</span>
          <span className="eyebrow sheet-toggle__hint">
            {sheetOpen ? "Hide list" : "Filter & search"}
          </span>
        </button>

        <div className="search">
          <input
            className="search__input"
            type="search"
            inputMode="search"
            placeholder="Find by number, owner, or bay"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            aria-label="Find an application"
          />
          {filters.search && (
            <button
              type="button"
              className="search__clear"
              onClick={() => setFilters((prev) => ({ ...prev, search: "" }))}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="panel__scroll">
          <FilterPanel
            filters={filters}
            statusCounts={statusCounts}
            applicants={facets.applicants}
            bays={facets.bays}
            groups={facets.groups}
            activeCount={activeCount}
            onToggle={toggle}
            onReset={reset}
          />
          <ResultList
            applications={visible}
            totalAcres={totalAcres}
            selectedId={selectedId}
            onSelect={select}
            onReset={reset}
            filtered={activeCount > 0}
          />
        </div>
      </aside>

      <MapCanvas
        applications={applications}
        visibleIds={visibleIds}
        selectedId={selectedId}
        onSelect={select}
        detailOpen={selected !== null}
      >
        {selected && (
          <DetailCard
            application={selected}
            readOnly={mode.readOnly}
            readOnlyReason={mode.reason}
            saving={saving}
            error={error}
            onSetStatus={(status) => setStatus(selected.id, status)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </MapCanvas>
    </div>
  );
}
