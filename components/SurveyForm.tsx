"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import SedimentBar from "@/components/SedimentBar";
import { currentFix, photoUrl, saveSample } from "@/lib/survey";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  FAR_FROM_POINT_FEET,
  REEF_LABEL,
  distanceFeet,
  draftFromSample,
  emptyDraft,
  hasErrors,
  validateDraft,
  type DraftErrors,
  type Fix,
  type SampleDraft,
  type SurveyPoint,
  type SurveySample,
} from "@/lib/surveyTypes";

type Props = {
  point: SurveyPoint;
  siteCode: string;
  /** The existing sample, when this point is being corrected rather than recorded. */
  sample: SurveySample | null;
  userId: string;
  onSaved: (sample: SurveySample) => void;
  onClose: () => void;
};

/**
 * The datasheet, as a form.
 *
 * Built for a tablet on a moving boat: everything is a large target, the two
 * yes/no questions are a pair of buttons rather than a dropdown, and the
 * counts have steppers so a wet finger never has to land on a caret. Number
 * inputs are 16px because anything smaller makes iOS zoom the page the moment
 * a field takes focus, and a zoomed page on a rocking deck is unusable.
 *
 * Which fields appear is decided entirely by the point's reef type -- the same
 * fork the datasheets and the CHECK constraints use.
 */
export default function SurveyForm({
  point,
  siteCode,
  sample,
  userId,
  onSaved,
  onClose,
}: Props) {
  const onReef = point.reef_type === "on";

  const [draft, setDraft] = useState<SampleDraft>(() =>
    sample ? draftFromSample(sample) : emptyDraft(),
  );
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Errors stay hidden until the first save attempt, so a blank form is not a wall of red. */
  const [showErrors, setShowErrors] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  const errors: DraftErrors = useMemo(
    () => validateDraft(draft, point.reef_type),
    [draft, point.reef_type],
  );
  const show = (key: keyof DraftErrors) => (showErrors ? errors[key] : undefined);

  const set = <K extends keyof SampleDraft>(key: K, value: SampleDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // Take a fix as soon as the form opens: the crew is at the point now, and
  // the position is worth less the longer it waits.
  useEffect(() => {
    let live = true;
    setLocating(true);
    currentFix()
      .then((next) => live && setFix(next))
      .catch((failure: Error) => live && setFixError(failure.message))
      .finally(() => live && setLocating(false));
    return () => {
      live = false;
    };
  }, []);

  // Show the photo already attached to a sample being corrected.
  useEffect(() => {
    if (!sample?.image_path || photo) return;
    const client = supabaseBrowser();
    if (!client) return;
    let live = true;
    photoUrl(client, sample.image_path).then((url) => {
      if (live && url) setPhotoPreview(url);
    });
    return () => {
      live = false;
    };
  }, [sample?.image_path, photo]);

  // A local preview is an object URL, so it has to be released.
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const takeFix = async () => {
    setLocating(true);
    setFixError(null);
    try {
      setFix(await currentFix());
    } catch (failure) {
      setFixError(failure instanceof Error ? failure.message : "Could not get a position.");
    } finally {
      setLocating(false);
    }
  };

  const offBy = fix
    ? distanceFeet({ lat: point.lat, lon: point.lon }, { lat: fix.lat, lon: fix.lon })
    : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (hasErrors(errors)) return;

    const client = supabaseBrowser();
    if (!client) {
      setError("Not connected to the platform.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await saveSample(client, {
        point,
        draft,
        fix,
        photo,
        existingImagePath: sample?.image_path ?? null,
        userId,
      });
      onSaved(saved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save the sample.");
      setSaving(false);
    }
  };

  return (
    <div className="survey-form" role="dialog" aria-modal="true" aria-label="Ground sample datasheet">
      <form className="survey-form__panel" onSubmit={submit}>
        <header className="survey-form__head">
          <div>
            <p className="eyebrow">
              Site {point.app_no} · {siteCode}
            </p>
            <h2 className="survey-form__title">
              Point {point.point_no}
              <span className="survey-form__badge" data-reef={point.reef_type}>
                {REEF_LABEL[point.reef_type]}
              </span>
            </h2>
          </div>
          <button
            type="button"
            className="survey-form__close"
            onClick={onClose}
            aria-label="Close without saving"
          >
            ✕
          </button>
        </header>

        <div className="survey-form__body">
          {sample && (
            <p className="survey-form__amending">
              Recorded {new Date(sample.recorded_at).toLocaleString()}. Saving replaces it.
            </p>
          )}

          {/* ----- position ------------------------------------------------ */}
          <section className="survey-form__section">
            <h3 className="eyebrow">Position</h3>
            <dl className="survey-form__coords">
              <div>
                <dt>Assigned</dt>
                <dd className="num">
                  {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
                </dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd className="num">
                  {fix ? `${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}` : locating ? "Locating…" : "—"}
                </dd>
              </div>
            </dl>

            {fix && (
              <p className="survey-form__fixnote" data-far={offBy !== null && offBy > FAR_FROM_POINT_FEET}>
                ±{fix.accuracy.toFixed(0)} m · {offBy!.toFixed(0)} ft from the assigned point
                {offBy! > FAR_FROM_POINT_FEET ? " — check you are on the right mark" : ""}
              </p>
            )}
            {fixError && <p className="survey-form__warn">{fixError}</p>}

            <button type="button" className="shape__btn" onClick={takeFix} disabled={locating}>
              {locating ? "Locating…" : fix ? "Update position" : "Capture position"}
            </button>
          </section>

          {/* ----- oysters -------------------------------------------------- */}
          <section className="survey-form__section">
            <h3 className="eyebrow">Oysters</h3>
            {onReef ? (
              <>
                <Stepper
                  label="Live oysters 6–25 mm"
                  value={draft.liveOysters6to25}
                  onChange={(v) => set("liveOysters6to25", v)}
                  error={show("liveOysters6to25")}
                />
                <Stepper
                  label="Live oysters > 25 mm"
                  value={draft.liveOystersGt25}
                  onChange={(v) => set("liveOystersGt25", v)}
                  error={show("liveOystersGt25")}
                />
                <Stepper
                  label="Oyster shells > 25 mm"
                  value={draft.oysterShellsGt25}
                  onChange={(v) => set("oysterShellsGt25", v)}
                  error={show("oysterShellsGt25")}
                />
                <Stepper
                  label="Black oyster shells > 25 mm"
                  value={draft.blackOysterShellsGt25}
                  onChange={(v) => set("blackOysterShellsGt25", v)}
                  error={show("blackOysterShellsGt25")}
                />
              </>
            ) : (
              <YesNo
                label="Live oysters present"
                value={draft.liveOystersPresent}
                onChange={(v) => set("liveOystersPresent", v)}
                error={show("liveOystersPresent")}
              />
            )}
          </section>

          {/* ----- seagrass ------------------------------------------------- */}
          <section className="survey-form__section">
            <h3 className="eyebrow">Seagrass</h3>
            <YesNo
              label="Seagrass present"
              value={draft.seagrass}
              onChange={(v) => set("seagrass", v)}
              error={show("seagrass")}
            />
          </section>

          {/* ----- sediment ------------------------------------------------- */}
          <section className="survey-form__section">
            <h3 className="eyebrow">Sediment composition</h3>
            {/* Two cut points on a bar, so the three shares always total 100.
                There is no running total to watch and nothing to correct --
                see components/SedimentBar.tsx. */}
            <SedimentBar
              mud={draft.pctMud}
              sand={draft.pctSand}
              shellHash={draft.pctShellHash}
              onChange={(mudPct, sandPct, shellPct) =>
                setDraft((prev) => ({
                  ...prev,
                  pctMud: mudPct,
                  pctSand: sandPct,
                  pctShellHash: shellPct,
                }))
              }
            />
            {showErrors && (errors.pctMud || errors.pctSand || errors.pctShellHash) && (
              <p className="survey-form__error">Set the sediment composition.</p>
            )}
          </section>

          {/* ----- photo ---------------------------------------------------- */}
          <section className="survey-form__section">
            <h3 className="eyebrow">Photo</h3>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              // Opens the rear camera straight away on a tablet rather than a
              // file browser full of screenshots.
              capture="environment"
              hidden
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
            {photoPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="survey-form__photo" src={photoPreview} alt="Sample photo" />
            )}
            <button type="button" className="shape__btn" onClick={() => fileInput.current?.click()}>
              {photoPreview ? "Retake photo" : "Take photo"}
            </button>
          </section>

          {/* ----- notes ---------------------------------------------------- */}
          <section className="survey-form__section">
            <h3 className="eyebrow">Notes</h3>
            <textarea
              className="survey-form__notes"
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Anything worth recording — tow direction, conditions, gear issues."
            />
          </section>

          {error && <p className="survey-form__error survey-form__error--save">{error}</p>}
        </div>

        <footer className="survey-form__actions">
          <button type="button" className="shape__btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="shape__btn shape__btn--save" disabled={saving}>
            {saving ? "Saving…" : sample ? "Save correction" : "Submit sample"}
          </button>
        </footer>
      </form>
    </div>
  );
}

/**
 * A count with big plus and minus keys either side.
 *
 * Oyster counts run from zero into the dozens and get entered with wet hands,
 * so tapping is the primary path and the keyboard is the fallback. Minus stops
 * at zero rather than going negative.
 */
function Stepper({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const step = (delta: number) => {
    const next = Math.max(0, (Number(value) || 0) + delta);
    onChange(String(next));
  };

  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <div className="stepper">
        <button type="button" className="stepper__key" onClick={() => step(-1)} aria-label={`${label}: one fewer`}>
          −
        </button>
        <input
          className="stepper__value num"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => {
            // Keep the box strictly digits so the value never disagrees with
            // what the stepper keys would produce.
            const cleaned = e.target.value.replace(/[^\d]/g, "");
            onChange(cleaned);
          }}
          placeholder="0"
          aria-label={label}
        />
        <button type="button" className="stepper__key" onClick={() => step(1)} aria-label={`${label}: one more`}>
          +
        </button>
      </div>
      {error && <p className="survey-form__error">{error}</p>}
    </div>
  );
}

/** A two-key segmented control. Nothing is preselected -- an unanswered question must look unanswered. */
function YesNo({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  error?: string;
}) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <div className="yesno" role="group" aria-label={label}>
        <button
          type="button"
          className="yesno__key"
          data-on={value === true}
          aria-pressed={value === true}
          onClick={() => onChange(true)}
        >
          Yes
        </button>
        <button
          type="button"
          className="yesno__key"
          data-on={value === false}
          aria-pressed={value === false}
          onClick={() => onChange(false)}
        >
          No
        </button>
      </div>
      {error && <p className="survey-form__error">{error}</p>}
    </div>
  );
}
