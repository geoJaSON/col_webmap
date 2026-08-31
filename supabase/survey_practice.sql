-- A practice site, for testing the form and training crew without putting a
-- fake observation into the real survey.
--
-- Run the SEED block in the Supabase SQL editor. Practice points then behave
-- exactly like assigned ones -- same tables, same constraints, same RLS, same
-- photo bucket -- so a test genuinely exercises the real path.
--
-- Why this is safe: application number 999 is not a TPWD application, and the
-- datasheet export is always scoped to one site
-- (/api/survey/csv?type=on&site=75), so 999 can never appear in anything sent
-- to TPWD. Two things do still notice it, both cosmetic:
--
--   * The layer panel's "N of 582 sampled" counts practice points in the
--     total, so it will read 588.
--   * The all-sites internal roll-up (/api/survey/csv?type=on with no site)
--     includes them, tagged with App# 999 in the first column.
--
-- Run the TEARDOWN block at the bottom when you are done to remove the site,
-- its points, and every practice sample in one go.

-- ===========================================================================
-- SEED
-- ===========================================================================

insert into public.survey_sites (app_no, site_code, on_reef_acres, off_reef_acres)
values (999, 'PRACTICE', null, null)
on conflict (app_no) do update set site_code = excluded.site_code;

-- Three of each type, because the two datasheets are different forms and both
-- need exercising: on-reef has the four count fields, off-reef has the single
-- presence toggle.
--
-- These sit in open water east of Hanna's Reef, clear of every assigned point
-- so nothing is ambiguous on the map. Move them if you would rather practise
-- somewhere specific -- the coordinates carry no meaning beyond being
-- somewhere to tap.
insert into public.survey_points (app_no, point_no, lat, lon, reef_type) values
  (999, 1, 29.465000, -94.770000, 'on'),
  (999, 2, 29.465400, -94.770400, 'on'),
  (999, 3, 29.465800, -94.770800, 'on'),
  (999, 4, 29.466200, -94.771200, 'off'),
  (999, 5, 29.466600, -94.771600, 'off'),
  (999, 6, 29.467000, -94.772000, 'off')
on conflict (app_no, point_no) do update set
  lat = excluded.lat,
  lon = excluded.lon,
  reef_type = excluded.reef_type;

-- ===========================================================================
-- TEARDOWN -- uncomment and run to remove the practice site entirely.
--
-- Samples go first: survey_points is the parent, and the app never deletes a
-- sample (no delete policy, no delete grant), so this is deliberately a
-- console-only operation running as a role that bypasses RLS.
-- ===========================================================================

-- delete from storage.objects
--   where bucket_id = 'survey-photos' and name like '999/%';
--
-- delete from public.survey_samples where app_no = 999;
-- delete from public.survey_points  where app_no = 999;
-- delete from public.survey_sites   where app_no = 999;
