"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchSurveyData, fetchSurveySites } from "@/lib/survey";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import type { SurveyPoint, SurveySample, SurveySite } from "@/lib/surveyTypes";

/**
 * Data for the field survey.
 *
 * Identity is not this hook's business any more -- the site-wide login means
 * whoever is here is already signed in, and `useAuth` says who. This just
 * fetches the assignment and tracks what has been collected.
 *
 * Points and samples are loaded when the layer is switched on rather than at
 * mount: the office use of this map has nothing to do with the survey, and
 * nearly two thousand points is not worth fetching for someone only looking at
 * lease boundaries. The site list is the exception -- two dozen rows, loaded
 * straight away, because it decides which area cards offer a datasheet
 * download whether or not the layer is on.
 */

/** `${app_no}:${point_no}` -- the composite key, flattened for Map/Set use. */
export const pointKey = (app_no: number, point_no: number) => `${app_no}:${point_no}`;

export type SurveyState = {
  on: boolean;
  toggle: () => void;
  sites: SurveySite[];
  points: SurveyPoint[];
  samples: Map<string, SurveySample>;
  loading: boolean;
  error: string | null;
  /** Assigned and sampled counts per application, once the points are loaded. */
  bySite: Map<number, { total: number; sampled: number }>;
  /** Fold a saved sample back into local state so the map repaints at once. */
  recordSample: (sample: SurveySample) => void;
  reload: () => void;
  progress: { sampled: number; total: number };
};

export function useSurvey(): SurveyState {
  const [on, setOn] = useState(false);
  const [sites, setSites] = useState<SurveySite[]>([]);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [samples, setSamples] = useState<Map<string, SurveySample>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to force a refetch. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const client = supabaseBrowser();
    if (!client) return;
    let live = true;
    fetchSurveySites(client)
      .then((next) => live && setSites(next))
      .catch(() => {
        // Not fatal: the cards just offer no download until the layer is
        // switched on, and that load reports its own errors.
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!on) return;
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
  }, [on, reloadKey]);

  const recordSample = useCallback((sample: SurveySample) => {
    setSamples((prev) => {
      const next = new Map(prev);
      next.set(pointKey(sample.app_no, sample.point_no), sample);
      return next;
    });
  }, []);

  const bySite = useMemo(() => {
    const counts = new Map<number, { total: number; sampled: number }>();
    for (const point of points) {
      const count = counts.get(point.app_no) ?? { total: 0, sampled: 0 };
      count.total += 1;
      if (samples.has(pointKey(point.app_no, point.point_no))) count.sampled += 1;
      counts.set(point.app_no, count);
    }
    return counts;
  }, [points, samples]);

  const progress = useMemo(
    () => ({ sampled: samples.size, total: points.length }),
    [samples.size, points.length],
  );

  return {
    on,
    toggle: useCallback(() => setOn((v) => !v), []),
    sites,
    points,
    samples,
    loading,
    error,
    bySite,
    recordSample,
    reload: useCallback(() => setReloadKey((k) => k + 1), []),
    progress,
  };
}
