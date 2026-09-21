-- Migration 003 — TPWD's 9/17 update to site 27 (GB29).
--
-- RUN THIS BEFORE re-running survey_seed.sql. It is one transaction: it either
-- completes and checks its own result, or changes nothing at all.
--
-- What TPWD changed ("updated from JWs coordinates 9/17/2026", in GB_NRS_4):
-- site 27 goes from 110 points (90 on / 20 off) to 102 (92 on / 10 off). Every
-- point moved, points 103-110 no longer exist, and 91-92 became on-reef.
--
-- Why the seed cannot do this alone: it only adds and updates points. It would
-- leave 103-110 behind, and it would move the coordinates of points the crew
-- had already sampled. It cannot run first either: the crew sampled all 20 old
-- off-reef points (91-110) on 2026-09-16, and the seed changing 91-92 to
-- on-reef under those samples fails the foreign key -- deliberately.
--
-- The decision taken for those 20 samples: a sample is carried over to a new
-- off-reef point when it was taken within one tow length (132 ft, measured
-- from where the boat actually was) of that point, the closest one where two
-- qualify. The rest are retired. TPWD should confirm they accept the carried
-- over samples.
--
--     old point -> new point   distance
--      91  ->   98      65 ft
--      92  ->  101      19 ft
--      95  ->   95      79 ft
--     100  ->  102      43 ft
--     102  ->   96      54 ft
--     104  ->   97      98 ft
--     105  ->   94     102 ft
--     106  ->  100      94 ft
--     107  ->   93     129 ft
--
--   retired (no new off-reef point within 132 ft): 93, 94, 96, 97, 98, 99, 101, 103, 108, 109, 110
--   new off-reef points still to sample: 99
--
-- Nothing is deleted outright. All 20 samples are copied verbatim into
-- survey_samples_archive first -- the carried-over ones too, as they stood --
-- photos, GPS fixes and all. The carried-over samples are re-numbered in place
-- rather than deleted and re-inserted, so each keeps its id, recorded_at and
-- recorded_by; the change shows in updated_at and in a note appended to the
-- sample.
--
-- Photo file names are left alone: a carried-over sample's photo is still
-- named for the old point it was taken at (e.g. 27-091-...jpg on new point 98).
-- That is the true record of where it was shot, and renaming would mean moving
-- files in Storage, not just a row here.
--
-- Guards: this stops without changing anything unless site 27 is exactly as it
-- was when this was written -- 110 points on the old coordinates, and samples on
-- points 91-110 and nowhere else. If the crew has sampled more of site 27 since,
-- those samples need the same decision first. Running it a second time is a
-- no-op.

-- ---------------------------------------------------------------------------
-- The archive: samples taken on an assignment TPWD later replaced.
-- The sample itself is kept as jsonb, verbatim, so this table never drifts
-- from survey_samples as that one gains columns.
-- ---------------------------------------------------------------------------
create table if not exists public.survey_samples_archive (
  archive_id           bigint generated always as identity primary key,
  archived_at          timestamptz not null default now(),
  archive_reason       text        not null,
  app_no               integer     not null,
  -- The point the sample was taken for, and where that point was.
  old_point_no         integer     not null,
  old_lat              numeric(9, 6),
  old_lon              numeric(9, 6),
  -- Set when the sample was carried over to the replacement assignment.
  relinked_to_point_no integer,
  relink_distance_ft   numeric(7, 1),
  sample               jsonb       not null
);

-- A record, not something the crew works from: service role only, like
-- col_applications.
alter table public.survey_samples_archive enable row level security;
revoke all on public.survey_samples_archive from anon, authenticated;

do $$
declare
  sampled int[];
begin
  -- Already applied?
  if exists (select 1 from public.survey_points
              where app_no = 27 and point_no = 1 and lat = 29.476712 and lon = -94.716979)
     and not exists (select 1 from public.survey_points where app_no = 27 and point_no > 102) then
    raise notice 'Site 27 already has the 9/17 assignment. Nothing to do.';
    return;
  end if;

  -- Exactly the state this was written against, or stop.
  if (select count(*) from public.survey_points where app_no = 27) <> 110
     or not exists (select 1 from public.survey_points
                     where app_no = 27 and point_no = 1 and lat = 29.479933 and lon = -94.719591) then
    raise exception 'Site 27 is not in the expected pre-update state. Nothing was changed.';
  end if;
  select array_agg(point_no order by point_no) into sampled
    from public.survey_samples where app_no = 27;
  if sampled is distinct from array[91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110] then
    raise exception 'Site 27 has samples on points % -- this was written for 91-110 only. Nothing was changed.', sampled;
  end if;

  -- 1. The verbatim record of all 20, as collected.
  insert into public.survey_samples_archive
    (archive_reason, app_no, old_point_no, old_lat, old_lon, relinked_to_point_no, relink_distance_ft, sample)
  select 'Taken on the site 27 assignment TPWD replaced on 2026-09-17 (GB_NRS_4, "updated from JWs coordinates").',
         s.app_no, s.point_no, p.lat, p.lon, m.new_point, m.feet, to_jsonb(s)
    from public.survey_samples s
    join public.survey_points p on p.app_no = s.app_no and p.point_no = s.point_no
    left join (values
      (91, 98, 64.6),
      (92, 101, 19.2),
      (95, 95, 79.4),
      (100, 102, 42.8),
      (102, 96, 53.5),
      (104, 97, 98.4),
      (105, 94, 102.4),
      (106, 100, 94.3),
      (107, 93, 128.6)
    ) as m(old_point, new_point, feet) on m.old_point = s.point_no
   where s.app_no = 27;

  -- 2. Retire the samples with no new point within a tow.
  delete from public.survey_samples
   where app_no = 27 and point_no in (93, 94, 96, 97, 98, 99, 101, 103, 108, 109, 110);

  -- 3. Carry the rest over, ordered so no two samples ever share a point.
  update public.survey_samples
     set point_no = 98,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 91 of the superseded assignment; carried over to point 98, 65 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 91;
  update public.survey_samples
     set point_no = 101,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 92 of the superseded assignment; carried over to point 101, 19 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 92;
  update public.survey_samples
     set point_no = 95,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 95 of the superseded assignment; carried over to point 95, 79 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 95;
  update public.survey_samples
     set point_no = 96,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 102 of the superseded assignment; carried over to point 96, 54 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 102;
  update public.survey_samples
     set point_no = 102,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 100 of the superseded assignment; carried over to point 102, 43 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 100;
  update public.survey_samples
     set point_no = 97,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 104 of the superseded assignment; carried over to point 97, 98 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 104;
  update public.survey_samples
     set point_no = 94,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 105 of the superseded assignment; carried over to point 94, 102 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 105;
  update public.survey_samples
     set point_no = 100,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 106 of the superseded assignment; carried over to point 100, 94 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 106;
  update public.survey_samples
     set point_no = 93,
         notes = concat_ws(E'\n', nullif(notes, ''),
           '[Sampled 2026-09-16 at point 107 of the superseded assignment; carried over to point 93, 129 ft away, after TPWD''s 9/17 update.]')
   where app_no = 27 and point_no = 107;

  -- 4. The new assignment. Points with a sample keep reef_type 'off', which
  --    is all the foreign key cares about; 91-92 have none left, so they can
  --    become on-reef.
  update public.survey_points p
     set lat = v.lat, lon = v.lon, reef_type = v.reef_type, reef_label = v.reef_label
    from (values
      (1, 29.476712, -94.716979, 'on', 'On Reef'),
      (2, 29.476846, -94.714596, 'on', 'On Reef'),
      (3, 29.478322, -94.715861, 'on', 'On Reef'),
      (4, 29.478817, -94.713943, 'on', 'On Reef'),
      (5, 29.479409, -94.715282, 'on', 'On Reef'),
      (6, 29.479705, -94.716074, 'on', 'On Reef'),
      (7, 29.479992, -94.719860, 'on', 'On Reef'),
      (8, 29.477310, -94.717140, 'on', 'On Reef'),
      (9, 29.479981, -94.713858, 'on', 'On Reef'),
      (10, 29.476783, -94.715304, 'on', 'On Reef'),
      (11, 29.480464, -94.718371, 'on', 'On Reef'),
      (12, 29.478375, -94.721133, 'on', 'On Reef'),
      (13, 29.479443, -94.713774, 'on', 'On Reef'),
      (14, 29.479621, -94.719658, 'on', 'On Reef'),
      (15, 29.480216, -94.714631, 'on', 'On Reef'),
      (16, 29.480700, -94.716006, 'on', 'On Reef'),
      (17, 29.479795, -94.716704, 'on', 'On Reef'),
      (18, 29.480563, -94.714255, 'on', 'On Reef'),
      (19, 29.478490, -94.714760, 'on', 'On Reef'),
      (20, 29.479271, -94.717921, 'on', 'On Reef'),
      (21, 29.477703, -94.716889, 'on', 'On Reef'),
      (22, 29.479514, -94.712368, 'on', 'On Reef'),
      (23, 29.480907, -94.715397, 'on', 'On Reef'),
      (24, 29.479201, -94.711242, 'on', 'On Reef'),
      (25, 29.477472, -94.712944, 'on', 'On Reef'),
      (26, 29.480661, -94.717611, 'on', 'On Reef'),
      (27, 29.480095, -94.713312, 'on', 'On Reef'),
      (28, 29.478611, -94.718855, 'on', 'On Reef'),
      (29, 29.479298, -94.713000, 'on', 'On Reef'),
      (30, 29.479027, -94.712062, 'on', 'On Reef'),
      (31, 29.480247, -94.717067, 'on', 'On Reef'),
      (32, 29.480152, -94.717845, 'on', 'On Reef'),
      (33, 29.478777, -94.718262, 'on', 'On Reef'),
      (34, 29.478263, -94.712510, 'on', 'On Reef'),
      (35, 29.481115, -94.718213, 'on', 'On Reef'),
      (36, 29.478889, -94.713383, 'on', 'On Reef'),
      (37, 29.478125, -94.718947, 'on', 'On Reef'),
      (38, 29.477941, -94.713406, 'on', 'On Reef'),
      (39, 29.479213, -94.715786, 'on', 'On Reef'),
      (40, 29.478942, -94.719353, 'on', 'On Reef'),
      (41, 29.478068, -94.718161, 'on', 'On Reef'),
      (42, 29.478825, -94.712626, 'on', 'On Reef'),
      (43, 29.478722, -94.716157, 'on', 'On Reef'),
      (44, 29.478150, -94.717156, 'on', 'On Reef'),
      (45, 29.478783, -94.710955, 'on', 'On Reef'),
      (46, 29.476589, -94.716202, 'on', 'On Reef'),
      (47, 29.479262, -94.716462, 'on', 'On Reef'),
      (48, 29.476111, -94.715740, 'on', 'On Reef'),
      (49, 29.479699, -94.717378, 'on', 'On Reef'),
      (50, 29.480132, -94.715706, 'on', 'On Reef'),
      (51, 29.479044, -94.720022, 'on', 'On Reef'),
      (52, 29.477698, -94.716193, 'on', 'On Reef'),
      (53, 29.476139, -94.714759, 'on', 'On Reef'),
      (54, 29.479297, -94.718582, 'on', 'On Reef'),
      (55, 29.477348, -94.713606, 'on', 'On Reef'),
      (56, 29.478420, -94.717712, 'on', 'On Reef'),
      (57, 29.478694, -94.711653, 'on', 'On Reef'),
      (58, 29.480370, -94.719283, 'on', 'On Reef'),
      (59, 29.479779, -94.714929, 'on', 'On Reef'),
      (60, 29.479685, -94.714363, 'on', 'On Reef'),
      (61, 29.478469, -94.719633, 'on', 'On Reef'),
      (62, 29.478220, -94.713961, 'on', 'On Reef'),
      (63, 29.479065, -94.714731, 'on', 'On Reef'),
      (64, 29.479001, -94.717481, 'on', 'On Reef'),
      (65, 29.477816, -94.719826, 'on', 'On Reef'),
      (66, 29.478123, -94.715309, 'on', 'On Reef'),
      (67, 29.476727, -94.713739, 'on', 'On Reef'),
      (68, 29.477974, -94.711941, 'on', 'On Reef'),
      (69, 29.478869, -94.715280, 'on', 'On Reef'),
      (70, 29.477678, -94.717658, 'on', 'On Reef'),
      (71, 29.481324, -94.717134, 'on', 'On Reef'),
      (72, 29.481446, -94.716110, 'on', 'On Reef'),
      (73, 29.478637, -94.722006, 'on', 'On Reef'),
      (74, 29.478128, -94.720494, 'on', 'On Reef'),
      (75, 29.478652, -94.716814, 'on', 'On Reef'),
      (76, 29.480296, -94.716325, 'on', 'On Reef'),
      (77, 29.477107, -94.716453, 'on', 'On Reef'),
      (78, 29.477997, -94.714594, 'on', 'On Reef'),
      (79, 29.477528, -94.718431, 'on', 'On Reef'),
      (80, 29.478204, -94.716475, 'on', 'On Reef'),
      (81, 29.477522, -94.719017, 'on', 'On Reef'),
      (82, 29.477096, -94.715745, 'on', 'On Reef'),
      (83, 29.479747, -94.719053, 'on', 'On Reef'),
      (84, 29.478368, -94.713045, 'on', 'On Reef'),
      (85, 29.477704, -94.714018, 'on', 'On Reef'),
      (86, 29.479971, -94.718468, 'on', 'On Reef'),
      (87, 29.480833, -94.716757, 'on', 'On Reef'),
      (88, 29.479308, -94.720812, 'on', 'On Reef'),
      (89, 29.477078, -94.718059, 'on', 'On Reef'),
      (90, 29.477689, -94.715503, 'on', 'On Reef'),
      (91, 29.477462, -94.714741, 'on', 'On Reef'),
      (92, 29.478739, -94.720693, 'on', 'On Reef'),
      (93, 29.477500, -94.720478, 'off', 'Off Reef'),
      (94, 29.478000, -94.722131, 'off', 'Off Reef'),
      (95, 29.477595, -94.721168, 'off', 'Off Reef'),
      (96, 29.476334, -94.716756, 'off', 'Off Reef'),
      (97, 29.475802, -94.716322, 'off', 'Off Reef'),
      (98, 29.475637, -94.715698, 'off', 'Off Reef'),
      (99, 29.477361, -94.719710, 'off', 'Off Reef'),
      (100, 29.476756, -94.718062, 'off', 'Off Reef'),
      (101, 29.476247, -94.717634, 'off', 'Off Reef'),
      (102, 29.477006, -94.719169, 'off', 'Off Reef')
    ) as v(point_no, lat, lon, reef_type, reef_label)
   where p.app_no = 27 and p.point_no = v.point_no;

  if exists (select 1 from public.survey_samples where app_no = 27 and point_no > 102) then
    raise exception 'A sample still references a point being removed. Nothing was changed.';
  end if;
  delete from public.survey_points where app_no = 27 and point_no > 102;

  update public.survey_sites
     set on_reef_acres = 105.3, off_reef_acres = 10.4
   where app_no = 27;

  -- 5. Check the result before letting the transaction commit.
  if (select count(*) from public.survey_points where app_no = 27) <> 102 then
    raise exception 'Expected 102 points for site 27. Rolled back.';
  end if;
  if (select array_agg(point_no order by point_no) from public.survey_samples where app_no = 27)
     is distinct from array[93, 94, 95, 96, 97, 98, 100, 101, 102] then
    raise exception 'Carried-over samples are not where expected. Rolled back.';
  end if;
  if (select count(*) from public.survey_samples_archive
       where app_no = 27 and archive_reason like 'Taken on the site 27 assignment%') <> 20 then
    raise exception 'Expected 20 archived samples. Rolled back.';
  end if;

  raise notice 'Site 27 updated: 102 points, 9 samples carried over, 11 retired, 20 archived.';
end $$;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- select count(*) from public.survey_points where app_no = 27;             -- 102
-- select point_no, recorded_at, updated_at from public.survey_samples
--  where app_no = 27 order by point_no;                                     -- 9 rows, recorded 2026-09-16
-- select old_point_no, relinked_to_point_no, relink_distance_ft
--   from public.survey_samples_archive where app_no = 27 order by old_point_no;  -- 20 rows
