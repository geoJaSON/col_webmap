"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchSurveyData } from "@/lib/survey";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import type { SurveyPoint, SurveySample, SurveySite } from "@/lib/surveyTypes";

/**
 * Session and data for the field survey.
 *
 * The Supabase client is the shared browser one, so a surveyor who signed in
 * for the polling layer is already signed in here and vice versa -- one
 * session, two features, no second password prompt on a boat.
 *
 * Data is loaded once when the layer is switched on rather than at mount: the
 * office use of this map has nothing to do with the survey, and 582 points is
 * not worth fetching for someone who is only looking at lease boundaries.
 */

/** `${app_no}:${point_no}` -- the composite key, flattened for Map/Set use. */
export const pointKey = (app_no: number, point_no: number) => `${app_no}:${point_no}`;

export type SurveyState = {
  on: boolean;
  toggle: () => void;
  userId: string | null;
  email: string | null;
  onSignedIn: (userId: string, email: string | null) => void;
  onSignOut: () => void;
  sites: SurveySite[];
  points: SurveyPoint[];
  samples: Map<string, SurveySample>;
  loading: boolean;
  error: string | null;
  /** Fold a saved sample back into local state so the map repaints at once. */
  recordSample: (sample: SurveySample) => void;
  reload: () => void;
  progress: { sampled: number; total: number };
};

export function useSurvey(): SurveyState {
  const [on, setOn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [sites, setSites] = useState<SurveySite[]>([]);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [samples, setSamples] = useState<Map<string, SurveySample>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to force a refetch. */
  const [reloadKey, setReloadKey] = useState(0);

  // Adopt an existing session so a return visit does not ask again. The
  // polling panel does the same against the same client; whichever runs first
  // wins and the other finds the session already there.
  useEffect(() => {
    const client = supabaseBrowser();
    if (!client) return;
    client.auth.getSession().then(({ data }) => {
      if (data.session) {
        setUserId(data.session.user.id);
        setEmail(data.session.user.email ?? null);
      }
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!on || !userId) return;
    const client = supabaseBrowser();
    if (!client) return;

    let live = true;
    setLoading(true);
    setError(null);

    fetchSurveyData(client)
      .then((data) => {
        if (!live) return;
        setSites(data.sites);
        setPoints(data.points);
        setSamples(
          new Map(data.samples.map((s) => [pointKey(s.app_no, s.point_no), s])),
        );
      })
      .catch((failure: Error) => live && setError(failure.message))
      .finally(() => live && setLoading(false));

    return () => {
      live = false;
    };
  }, [on, userId, reloadKey]);

  const recordSample = useCallback((sample: SurveySample) => {
    setSamples((prev) => {
      const next = new Map(prev);
      next.set(pointKey(sample.app_no, sample.point_no), sample);
      return next;
    });
  }, []);

  const progress = useMemo(
    () => ({ sampled: samples.size, total: points.length }),
    [samples.size, points.length],
  );

  return {
    on,
    toggle: useCallback(() => setOn((v) => !v), []),
    userId,
    email,
    onSignedIn: useCallback((id: string, address: string | null) => {
      setUserId(id);
      setEmail(address);
    }, []),
    onSignOut: useCallback(() => {
      setUserId(null);
      setEmail(null);
      setOn(false);
      setSites([]);
      setPoints([]);
      setSamples(new Map());
    }, []),
    sites,
    points,
    samples,
    loading,
    error,
    recordSample,
    reload: useCallback(() => setReloadKey((k) => k + 1), []),
    progress,
  };
}
