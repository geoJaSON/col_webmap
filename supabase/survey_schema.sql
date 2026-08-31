-- Field survey: assigned ground samples and the observations collected at them.
-- Run this once in the Supabase SQL editor, then run survey_seed.sql.
--
-- Trust model differs from col_applications on purpose. That table is reached
-- only by this app's API routes holding the service-role key, so it has RLS on
-- and no policies at all. These tables are read and written by the *browser* as
-- the signed-in surveyor -- the same anon-key-plus-RLS path the polling layer
-- already uses -- because photos go straight to Storage and proxying multi-
-- megabyte uploads through Next.js on a marine connection helps nobody. So
-- here the policies are the security, and they are written out in full.

-- ---------------------------------------------------------------------------
-- Sites: one per COL application TPWD has assigned samples for.
-- ---------------------------------------------------------------------------
create table if not exists public.survey_sites (
  -- The TPWD application number, matching public.col_applications.id. Not
  -- declared as a foreign key: the two tables are seeded from workbooks that
  -- arrive separately, and a sample assignment landing before its application
  -- should not be an error.
  app_no          integer primary key,
  -- TPWD's own site code, e.g. GB20. Shown alongside the app number because
  -- their correspondence uses both.
  site_code       text    not null,
  on_reef_acres   numeric(8, 2),
  off_reef_acres  numeric(8, 2)
);

-- ---------------------------------------------------------------------------
-- Points: the coordinates TPWD assigned. Seeded, never edited by the app.
-- ---------------------------------------------------------------------------
create table if not exists public.survey_points (
  app_no      integer not null references public.survey_sites (app_no) on delete cascade,
  -- Restarts at 1 within each site, so it is only unique alongside app_no.
  point_no    integer not null,
  -- Decimal degrees, WGS84. numeric rather than float so the coordinate that
  -- goes back to TPWD is exactly the one they sent.
  lat         numeric(9, 6) not null,
  lon         numeric(9, 6) not null,
  -- Decides which datasheet the crew fills in, so it drives the whole form.
  --
  -- Re-seeding a point whose reef_type has changed will be refused while a
  -- sample references it, because the sample's own reef_type is pinned to this
  -- one. That is the intended outcome: a point that has switched datasheets
  -- has to be collected again, and a silent flip would leave a row whose
  -- columns belong to the other sheet.
  reef_type   text    not null,
  primary key (app_no, point_no)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'survey_points_reef_type_check'
      and conrelid = 'public.survey_points'::regclass
  ) then
    alter table public.survey_points
      add constraint survey_points_reef_type_check check (reef_type in ('on', 'off'));
  end if;

  -- Redundant against the primary key, but it is what lets survey_samples
  -- carry a copy of reef_type under a composite foreign key -- see below.
  if not exists (
    select 1 from pg_constraint
    where conname = 'survey_points_type_key'
      and conrelid = 'public.survey_points'::regclass
  ) then
    alter table public.survey_points
      add constraint survey_points_type_key unique (app_no, point_no, reef_type);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Samples: what the crew recorded. One row per assigned point.
--
-- The two datasheets share the sediment and seagrass fields but diverge on
-- oysters: on-reef counts four categories, off-reef records presence only. A
-- CHECK cannot reach into survey_points to find out which applies, so
-- reef_type is copied down here and pinned to the point's own value by a
-- composite foreign key. It cannot drift, and the per-type field rules below
-- become constraints the database actually enforces.
-- ---------------------------------------------------------------------------
create table if not exists public.survey_samples (
  id            bigint generated always as identity primary key,
  app_no        integer not null,
  point_no      integer not null,
  reef_type     text    not null,

  -- Where the boat actually was, from the device GPS, with the accuracy the
  -- browser reported. A ~132 ft dredge tow does not sit on its assigned
  -- coordinate, and "how far off, and how sure are we" is the question that
  -- gets asked later.
  gps_lat        numeric(9, 6),
  gps_lon        numeric(9, 6),
  gps_accuracy_m numeric(6, 1),
  gps_taken_at   timestamptz,

  -- Shared by both datasheets.
  seagrass          boolean not null,
  pct_mud           integer not null,
  pct_sand          integer not null,
  pct_shell_hash    integer not null,

  -- On-reef only: counts.
  live_oysters_6_25mm         integer,
  live_oysters_gt_25mm        integer,
  oyster_shells_gt_25mm       integer,
  black_oyster_shells_gt_25mm integer,

  -- Off-reef only: presence.
  live_oysters_present  boolean,

  -- Storage object path in the survey-photos bucket. The datasheet's
  -- "Image File Name" column is derived from this on export.
  image_path    text,
  notes         text,

  recorded_by   uuid not null references auth.users (id),
  recorded_at   timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  updated_at    timestamptz not null default now(),

  constraint survey_samples_point_fkey
    foreign key (app_no, point_no, reef_type)
    references public.survey_points (app_no, point_no, reef_type)
    on delete cascade,

  -- One sample per assigned point. Re-recording a point corrects the existing
  -- row rather than adding a second, which keeps "sampled / not sampled"
  -- unambiguous on the map.
  constraint survey_samples_point_key unique (app_no, point_no)
);

do $$
begin
  -- Sediment is a composition, so it has to total 100. This is the single most
  -- likely data-quality slip and the cheapest one to make impossible.
  if not exists (
    select 1 from pg_constraint
    where conname = 'survey_samples_sediment_total_check'
      and conrelid = 'public.survey_samples'::regclass
  ) then
    alter table public.survey_samples
      add constraint survey_samples_sediment_total_check
      check (pct_mud + pct_sand + pct_shell_hash = 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'survey_samples_sediment_range_check'
      and conrelid = 'public.survey_samples'::regclass
  ) then
    alter table public.survey_samples
      add constraint survey_samples_sediment_range_check
      check (
        pct_mud between 0 and 100
        and pct_sand between 0 and 100
        and pct_shell_hash between 0 and 100
      );
  end if;

  -- Counts are counts.
  if not exists (
    select 1 from pg_constraint
    where conname = 'survey_samples_counts_check'
      and conrelid = 'public.survey_samples'::regclass
  ) then
    alter table public.survey_samples
      add constraint survey_samples_counts_check
      check (
        coalesce(live_oysters_6_25mm, 0) >= 0
        and coalesce(live_oysters_gt_25mm, 0) >= 0
        and coalesce(oyster_shells_gt_25mm, 0) >= 0
        and coalesce(black_oyster_shells_gt_25mm, 0) >= 0
      );
  end if;

  -- The datasheet the row claims to be must be the datasheet it actually
  -- filled in: on-reef carries the four counts and no presence flag, off-reef
  -- the reverse. Without this a half-filled form writes rows that export as
  -- blanks and nobody notices until TPWD does.
  if not exists (
    select 1 from pg_constraint
    where conname = 'survey_samples_shape_check'
      and conrelid = 'public.survey_samples'::regclass
  ) then
    alter table public.survey_samples
      add constraint survey_samples_shape_check
      check (
        (reef_type = 'on'
          and live_oysters_6_25mm is not null
          and live_oysters_gt_25mm is not null
          and oyster_shells_gt_25mm is not null
          and black_oyster_shells_gt_25mm is not null
          and live_oysters_present is null)
        or
        (reef_type = 'off'
          and live_oysters_present is not null
          and live_oysters_6_25mm is null
          and live_oysters_gt_25mm is null
          and oyster_shells_gt_25mm is null
          and black_oyster_shells_gt_25mm is null)
      );
  end if;
end $$;

-- The unique constraint already indexes (app_no, point_no), which serves the
-- composite foreign key too. These cover the RLS predicate and the per-site
-- filter the app leads with.
create index if not exists survey_samples_recorded_by_idx
  on public.survey_samples (recorded_by);
create index if not exists survey_points_app_no_idx
  on public.survey_points (app_no);

-- ---------------------------------------------------------------------------
-- Stamping. recorded_by is taken from the JWT rather than trusted from the
-- request body, so a client cannot file a sample under someone else's name --
-- and it stays put on update, while updated_by records who touched it last.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_survey_sample()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- coalesce, not a bare assignment: auth.uid() is null when the row comes
    -- from service_role (a backfill or a migration), and overwriting a
    -- supplied value with null there would only trip the not-null constraint.
    -- For a signed-in surveyor auth.uid() is always set, so it always wins.
    new.recorded_by = coalesce(auth.uid(), new.recorded_by);
    new.recorded_at = now();
    new.updated_by = null;
  else
    new.recorded_by = old.recorded_by;
    new.recorded_at = old.recorded_at;
    new.updated_by = auth.uid();
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists survey_samples_stamp on public.survey_samples;
create trigger survey_samples_stamp
  before insert or update on public.survey_samples
  for each row execute function public.stamp_survey_sample();

-- ---------------------------------------------------------------------------
-- Access control
--
-- Signed-in surveyors only; anon gets nothing anywhere. auth.uid() is wrapped
-- in a subselect so it is evaluated once per statement rather than once per
-- row.
-- ---------------------------------------------------------------------------
alter table public.survey_sites   enable row level security;
alter table public.survey_points  enable row level security;
alter table public.survey_samples enable row level security;

revoke all on public.survey_sites   from anon, authenticated;
revoke all on public.survey_points  from anon, authenticated;
revoke all on public.survey_samples from anon, authenticated;

grant select on public.survey_sites  to authenticated;
grant select on public.survey_points to authenticated;
grant select, insert, update on public.survey_samples to authenticated;

-- The assignment is reference data: everyone signed in reads it, nobody
-- writes it. New points arrive by re-running survey_seed.sql as service_role.
drop policy if exists survey_sites_read on public.survey_sites;
create policy survey_sites_read on public.survey_sites
  for select to authenticated using (true);

drop policy if exists survey_points_read on public.survey_points;
create policy survey_points_read on public.survey_points
  for select to authenticated using (true);

-- The crew works one survey together, so everyone sees every sample -- that is
-- what makes "already sampled" trustworthy on a second boat's tablet.
drop policy if exists survey_samples_read on public.survey_samples;
create policy survey_samples_read on public.survey_samples
  for select to authenticated using (true);

-- The trigger overwrites recorded_by with auth.uid() regardless, so this check
-- is belt and braces rather than the only thing standing there.
drop policy if exists survey_samples_insert on public.survey_samples;
create policy survey_samples_insert on public.survey_samples
  for insert to authenticated
  with check (recorded_by = (select auth.uid()));

-- Corrections are a normal part of a survey day and the tablet is often
-- shared, so any signed-in surveyor may amend a sample. updated_by records who
-- did, and recorded_by is pinned by the trigger.
drop policy if exists survey_samples_update on public.survey_samples;
create policy survey_samples_update on public.survey_samples
  for update to authenticated using (true) with check (true);

-- Deliberately no delete policy and no delete grant: a collected sample is a
-- regulatory record. Amend it, do not remove it.

-- ---------------------------------------------------------------------------
-- Photo storage
--
-- Private bucket: the crew signs in, and reads go through short-lived signed
-- URLs rather than a public path, so a sample photo is not guessable from its
-- point number.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-photos',
  'survey-photos',
  false,
  20971520, -- 20 MB; a tablet photo is a few MB even before downscaling.
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists survey_photos_read on storage.objects;
create policy survey_photos_read on storage.objects
  for select to authenticated using (bucket_id = 'survey-photos');

drop policy if exists survey_photos_write on storage.objects;
create policy survey_photos_write on storage.objects
  for insert to authenticated with check (bucket_id = 'survey-photos');

-- Re-shooting a photo for a sample overwrites it, so update is allowed;
-- delete is not, matching the samples table.
drop policy if exists survey_photos_update on storage.objects;
create policy survey_photos_update on storage.objects
  for update to authenticated using (bucket_id = 'survey-photos');
