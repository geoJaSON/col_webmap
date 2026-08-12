-- COL application status tracker -- schema.
-- Run this once in the Supabase SQL editor, then run seed.sql.

create table if not exists public.col_applications (
  -- TPWD Application # is the real-world identifier, so it is the primary key.
  -- No surrogate id: there is exactly one row per application and the numbers
  -- are assigned by TPWD, not by us.
  id          integer primary key,
  group_name  text        not null,
  status      text        not null,
  applicant   text        not null,
  bay_system  text        not null,
  acreage     numeric(6, 2),
  -- GeoJSON Polygon. Kept as jsonb rather than PostGIS geometry because the
  -- app only ever reads it back out verbatim to draw on the map -- no spatial
  -- queries, so PostGIS would be a dependency with nothing to do.
  geometry    jsonb       not null,
  updated_at  timestamptz not null default now()
);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard it to keep this file
-- re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'col_applications_status_check'
      and conrelid = 'public.col_applications'::regclass
  ) then
    alter table public.col_applications
      add constraint col_applications_status_check
      check (status in ('Accept', 'Modify', 'Decline'));
  end if;
end $$;

-- Keep updated_at honest without the app having to remember.
create or replace function public.touch_col_applications()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists col_applications_touch on public.col_applications;
create trigger col_applications_touch
  before update on public.col_applications
  for each row execute function public.touch_col_applications();

-- ---------------------------------------------------------------------------
-- Access control
--
-- The browser never talks to Supabase directly -- the Next.js API routes hold
-- the service role key and are the only client. So: enable RLS and write no
-- policies at all. anon and authenticated match nothing and get nothing;
-- service_role has BYPASSRLS and sees everything. Revoking the default grants
-- as well means a leaked anon key is inert against this table.
-- ---------------------------------------------------------------------------
alter table public.col_applications enable row level security;

revoke all on public.col_applications from anon, authenticated;

-- 78 rows. The primary key is the only index this table will ever need;
-- filtering by status/applicant happens client-side over the full set.
