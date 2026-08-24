"use client";

import { STATUSES, STATUS_COLORS, type Application, type Status } from "@/lib/types";

type Props = {
  application: Application;
  readOnly: boolean;
  readOnlyReason?: string;
  saving: boolean;
  error: string | null;
  editing: boolean;
  onEditShape: () => void;
  onSetStatus: (status: Status) => void;
  onClose: () => void;
  /** The shape editor, rendered in place of the status buttons while open. */
  children?: React.ReactNode;
};

export default function DetailCard({
  application,
  readOnly,
  readOnlyReason,
  saving,
  error,
  editing,
  onEditShape,
  onSetStatus,
  onClose,
  children,
}: Props) {
  const vertices = application.geometry.coordinates[0]?.length ?? 1;

  return (
    <aside
      className="detail"
      data-editing={editing}
      aria-label={`Application ${application.id}`}
    >
      <div className="detail__head">
        <span className="detail__id">{application.id}</span>
        <span className="detail__names">
          <span className="eyebrow">TPWD application</span>
          <span className="detail__applicant">{application.applicant}</span>
        </span>
        <button type="button" className="detail__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="detail__facts">
        <div className="fact">
          <div className="eyebrow">Acreage</div>
          <div className="fact__value">{application.acreage?.toFixed(2) ?? "—"}</div>
        </div>
        <div className="fact">
          <div className="eyebrow">Bay system</div>
          <div className="fact__value">{application.bay_system}</div>
        </div>
        <div className="fact">
          <div className="eyebrow">Owner</div>
          <div className="fact__value">{application.group_name}</div>
        </div>
        <div className="fact">
          <div className="eyebrow">Corners</div>
          {/* The ring repeats its first point to close; report real corners. */}
          <div className="fact__value">{vertices - 1}</div>
        </div>
      </div>

      {editing ? (
        children
      ) : (
      <div className="detail__actions">
        <div className="detail__actions-head">
          <span className="eyebrow">Status</span>
          {!readOnly && (
            <button type="button" className="detail__edit" onClick={onEditShape}>
              Edit shape
            </button>
          )}
        </div>
        <div className="status-set">
          {STATUSES.map((status) => {
            const on = application.status === status;
            return (
              <button
                key={status}
                type="button"
                className="status-btn"
                data-on={on}
                aria-pressed={on}
                disabled={readOnly || saving}
                style={on ? { background: STATUS_COLORS[status], borderColor: STATUS_COLORS[status] } : undefined}
                onClick={() => onSetStatus(status)}
              >
                {status}
              </button>
            );
          })}
        </div>

        {readOnly && <p className="detail__note">{readOnlyReason ?? "This view is read-only."}</p>}
        {error && <p className="detail__error">{error}</p>}
      </div>
      )}
    </aside>
  );
}
