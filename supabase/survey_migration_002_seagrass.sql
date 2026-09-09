-- Migration 002 — the Aransas Bay batch.
--
-- Run this once against an existing database, then re-run survey_seed.sql.
-- A database created fresh from survey_schema.sql already has both changes and
-- does not need this file.
--
-- Two things in Woody_Jurisich_AB_NRS_1.xlsx do not fit the shape the first
-- Galveston workbook implied:
--
--   1. Its worksheets are named "112" and "113" — bare application numbers with
--      no TPWD site code. site_code was NOT NULL because every sheet in the
--      first batch had one.
--
--   2. It introduces a third reef class, "Off Reef Seagrass" (TPWD's acreage
--      block words it "Off Reef (potential seagrass)"). 100 of the 136 AB
--      points carry it.
--
-- reef_type stays two-valued on purpose. It is what decides which of TPWD's
-- two datasheets the crew fills in, and they only ever sent two — an
-- off-reef-seagrass sample is recorded on the off-reef sheet. Widening
-- reef_type to a third value would change which columns are required, via the
-- survey_samples_shape_check constraint, and no third datasheet exists to
-- require them.
--
-- So the class is preserved alongside it instead. That matters operationally:
-- a seagrass sample is worked with different gear, and the crew has to know
-- before they leave the dock.

-- ---------------------------------------------------------------------------
-- 1. Sites without a TPWD site code
-- ---------------------------------------------------------------------------
alter table public.survey_sites
  alter column site_code drop not null;

-- ---------------------------------------------------------------------------
-- 2. TPWD's verbatim reef class, per point
--
-- Nullable rather than defaulted: rows seeded before this migration have no
-- label until survey_seed.sql is re-run, and a made-up default would be
-- indistinguishable from one TPWD actually sent. Re-running the seed fills
-- every row in — it is in the `on conflict do update` list.
-- ---------------------------------------------------------------------------
alter table public.survey_points
  add column if not exists reef_label text;

comment on column public.survey_points.reef_label is
  'TPWD''s own wording for the reef class, verbatim: "On Reef", "Off Reef", or '
  '"Off Reef Seagrass". reef_type collapses these to on/off to pick the '
  'datasheet; this keeps the distinction the gear depends on.';

-- ---------------------------------------------------------------------------
-- Verification — expect 16 sites, 1003 points, and three reef classes.
-- ---------------------------------------------------------------------------
-- select count(*) as sites from public.survey_sites;
-- select count(*) as points from public.survey_points;
-- select reef_type, reef_label, count(*)
--   from public.survey_points group by 1, 2 order by 1, 2;
-- select app_no, site_code from public.survey_sites where site_code is null;
