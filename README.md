# COL Status

A web map of the 78 TPWD Certificate of Location applications in
`Justin_Johny_COL_Status.xlsx`. Polygons are coloured by status, filterable by
owner, bay system, and reviewer, searchable by application number or name, and
each one's status can be changed in two taps from a phone or a desktop.

## What's here

| Path | What it does |
|------|--------------|
| `scripts/extract_xlsx.py` | Reads the workbooks, validates every polygon, writes `data/applications.json`, `supabase/seed.sql` and `supabase/apply_mods.sql` |
| `JW_JJ_Hanna mods.xlsx` | Boundary modifications overlaid on the base data (6 applications) |
| `supabase/apply_mods.sql` | Updates just those 6 rows: new geometry, new acreage, status `Modify` |
| `data/applications.json` | The 78 applications, shaped exactly like a database row |
| `supabase/schema.sql` | Table, status constraint, `updated_at` trigger, RLS lockdown |
| `supabase/seed.sql` | Re-runnable inserts for all 78 rows |
| `lib/geometry.ts` | Coordinate parsing, ring validation, and acreage — shared by the browser and the API |
| `scripts/import_layers.py` | Converts reference shapefiles into categorised layers under `public/layers/` |
| `layers.config.json` | Blocker categories: colour, default buffer, and which shapefile belongs to which |
| `lib/buffer.ts` | On-the-fly buffering, culled to the viewport |
| `lib/csv.ts` | CSV export laid out like the original `GIS Upload` sheet |
| `lib/pollingTiles.ts` | MapLibre protocol that reads platform polling tiles as the signed-in user |
| `lib/substrate.ts` | Polling-point colours, copied from the platform field map |
| `public/layers/` | Generated reference layers plus the `index.json` the map reads |
| `app/`, `components/`, `lib/` | The Next.js app |

## Running it locally

```bash
npm install
npm run dev
```

With no database configured it loads the polygons straight from
`data/applications.json` and says so — the map, filters, and search all work,
but the status buttons are disabled. That is the intended fresh-clone
experience; wire up Supabase to make it writable.

## Setting up the database

1. Create a project at [supabase.com](https://supabase.com) (the free tier is
   ample — this is one table with 78 rows).
2. In the SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`.
3. Copy `.env.example` to `.env.local` and fill in the two values from
   **Project Settings → API**:

   ```
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

Restart `npm run dev` and the status buttons become live.

### Why the service role key is safe here

The browser never talks to Supabase. Every read and write goes through this
app's own `/api` routes, which run on the server and hold the key. The table
has RLS enabled with **no policies at all**, so `anon` and `authenticated`
match nothing; only `service_role`, which bypasses RLS, can see the rows. There
is no Supabase key in the client bundle to leak.

## Deploying to Vercel

```bash
npx vercel
```

Then add all four variables from `.env.example` under **Settings → Environment
Variables** and redeploy.

The two `NEXT_PUBLIC_` ones are **required**, not optional: the whole site is
behind a sign-in and without them nobody can get in at all. They are read into
the bundle at build time, so if a deploy goes out missing them, setting them
afterwards is not enough — redeploy without the build cache.

## Signing in

The whole site — every page and every API route — requires a **CV Carbon
account**. Sign in at `/login` with the same email and password as the wider
platform; there is no separate account for this map, no sign-up page, and no
password reset here. Accounts are staff accounts, managed on the platform.

This replaced a shared site passcode. The passcode was one door, and then
polling points and ground samples each asked for a *second* Supabase sign-in
inside the Layers panel — two passwords for one app, with the second hidden
behind a padlock icon on a layer toggle. Now there is one login and both of
those layers simply work.

What that removed: `middleware.ts`'s passcode check, `lib/access.ts`,
`app/unlock/`, `app/api/unlock/`, the `SITE_PASSCODE` variable, and the
sign-in form that used to live in each of `PollingPanel` and `SurveyPanel`.

### How the gate works

`middleware.ts` is the only place the decision lives. It runs on every request,
calls `supabase.auth.getUser()` — which revalidates the token with Supabase
rather than trusting a cookie the browser could have forged — and redirects to
`/login` (or answers `401` on `/api/*`, so a fetch fails as JSON rather than as
HTML it cannot parse). A deep link is remembered in `?next=`, so signing in
lands you where you were going.

The session lives in **cookies**, not localStorage, and that detail is
load-bearing: it is the only reason middleware can see who you are before a
page renders. That is why `lib/supabaseBrowser.ts` uses `createBrowserClient`
from `@supabase/ssr`. Swapping it back for the plain `createClient` would lock
everyone out.

### Who this lets in

The check is "has a session in this Supabase project", nothing finer. That is
safe **today** because the project is the CV Carbon platform and `auth.users`
holds staff accounts only — lessees and other clients authenticate through
AGOL, not Supabase. So "authenticated" and "our team" are currently the same
set of people.

If client accounts are ever added to this project, that stops being true and
the gate silently widens to include them. The fix at that point is an
allowlist — a table of who may see COL data, checked in the middleware — and
nothing else in the app has to change. The assumption is written down at the
check itself so it is hard to miss.

## Re-importing the workbook

If TPWD sends a revised spreadsheet, drop it in place and run:

```bash
npm run extract
```

Then re-run `supabase/seed.sql`. The inserts are `on conflict do update` and
**deliberately leave `status` alone** — geometry, acreage, owner, and bay system
are refreshed from the workbook, but decisions already recorded in the app are
not overwritten. Delete the rows first if you do want to reset statuses.

### Boundary modifications

`JW_JJ_Hanna mods.xlsx` overlays the base data. For each row carrying an
`Application#` it swaps in the `Modified Coordinates` ring, replaces the acreage
with `New acreage`, and forces the status to `Modify` — every application in
that workbook had its boundary redrawn, whichever of its several disagreeing
Status/Reevaluation columns you read.

Before overwriting anything it checks that the sheet's `Corner Coordinates`
(the pre-modification ring) match the geometry already on hand, so the two
workbooks drifting apart is an error rather than a silent bad overwrite. A ring
that already matches the modification is recognised as previously applied, which
makes `npm run extract` safe to re-run.

Because `seed.sql` never touches `status`, these six need
`supabase/apply_mods.sql` run against the database as well.

The base workbook is optional: if `Justin_Johny_COL_Status.xlsx` is not present,
the extractor uses the committed `data/applications.json` as its base so the
overlay still works.

The extractor validates as it goes: it checks each `Coordinate Count` against
the vertices actually present, drops repeated vertices (application 107 lists
one twice), forces counter-clockwise winding for GeoJSON, and reports any ring
that self-intersects or any status outside Accept/Modify/Decline. The current
workbook passes with one duplicate-vertex cleanup and no errors.

## Using the map

- **Ledger** — the strip across the top is all 78 applications in TPWD number
  order. Tick width is acreage, colour is status; ticks outside the current
  filter fade. Click one to jump to it.
- **Find** — type an application number, owner, or bay in the search box.
- **Filter** — status, owner, bay system, and reviewer stack together. The map
  reframes to whatever is left, so picking one owner flies to their leases.
- **Change a status** — click a polygon, a list row, or a ledger tick, then
  press Accept, Modify, or Decline. It saves immediately.
- **Reshape a lease** — select it, then press **Edit shape**. The map zooms in
  and puts a handle on every corner:
  - **drag** a handle to move that corner,
  - **click a hollow midpoint** to add a corner there,
  - **double-click** a corner to remove it (three is the floor).

  The box below lists the same corners as `latitude, longitude`, one per line.
  Paste a new set over it and the map redraws as you type. Separators are
  forgiving — commas, tabs, or runs of spaces all work, a whole ring on one
  line works, and a repeated closing point is dropped. If a paste is in
  `longitude, latitude` order it is detected and read that way, because
  latitude can never exceed 90 on this coast.

  Corner count and acreage update live, with the change against the stored
  figure. **Save shape** writes it; **Reset** returns to the stored outline and
  **Cancel** leaves without saving. Escape closes the editor before it clears
  the selection.
- **Basemaps** — *Chart* is NOAA's Maritime Chart Service, which shows charted
  reefs, depths, and the ICW, and is the default because that is the context
  these decisions are made in. *Satellite* and *Plain* are one tap away.
- **Export CSV** — the **CSV** link in the results header downloads one row per
  application with its corner coordinates, laid out like the `GIS Upload` sheet
  the data came from: the fixed fields, then `Latitude N` / `Longitude N` pairs
  across. It exports exactly what the list is showing, so filtering to one
  entity exports that entity; the file name records it
  (`col-areas-2026-08-26-13-of-78.csv`).

  Corner columns run out to the widest polygon in the exported set rather than
  a fixed ten, so a filtered export does not trail empty columns. Values are
  quoted where needed — nearly every entity name contains a comma — and the
  file is written with a BOM and CRLF endings so Excel opens it cleanly.

## Polling points

The Supabase project behind this app is the wider oyster platform, not a
database of its own — `col_applications` sits alongside roughly 200 other
tables. One of them, `gis_polling_points`, holds about 1.7 million points, and
the platform already exposes `rpc/mvt_polling_points(z, x, y, p_year)` which
returns a Mapbox Vector Tile.

**Show polling points** in the Layers control turns that on. The tile function
filters by who is asking — called without a user it returns an empty tile — so
this only works because you are already signed in site-wide. It used to carry
its own sign-in form; that is gone.

How it is wired:

- The access token comes from the site-wide session, read at request time
  rather than captured, so a token refresh partway through a long day takes
  effect on the next tile.
- Tiles are fetched through a MapLibre custom protocol (`polling://`) rather
  than proxied through this app's server. The person's access token therefore
  never touches our server or our logs — it goes straight to Supabase, and the
  function's own per-user filtering decides what comes back.
- The function returns the tile as base64 text inside a JSON string, because
  PostgREST will not serve the underlying type as `application/octet-stream`.
  The protocol handler decodes it before handing MapLibre the bytes.
- Tiles are only requested at zoom 14 and above, which is where the function
  starts answering; below that it returns `null`.

Points are coloured by substrate using the same palette as the platform's
field map and mobile app, so a point means the same thing in all three:

| Substrate | | Substrate | |
|---|---|---|---|
| Solid Reef | `#31AD41` | Buried Shell | `#B2E061` |
| Scattered Shell | `#F79F40` | Sand | `#FF0000` |
| Mud | `#BD7EBE` | Too Deep to Poll | `#000000` |
| Firm/Hard Bottom | `#FFF15C` | *unrecognised* | `#9E9E9E` |

Radii, opacity, and the dark casing match too. Don't re-pick these — people
read them by eye across the three apps. The key is rendered under the toggle
rather than as a permanent legend bar, because seven swatches on screen at all
times is clutter when the layer is off.

This uses the **anon** key, which is public by design and safe in the bundle —
a different key and a different trust model from the service-role key the COL
API routes use.

## Ground samples (field survey)

TPWD assigns ground samples for each accepted COL and expects the results back
on their own datasheets. **Ground samples** in the Layers control draws those
assigned points and turns each one into a form the crew fills in on a tablet.

The first round covers **582 points across 9 sites** — applications 1, 8, 9,
14, 15, 22, 56, 75 and 107 — split 318 on-reef / 264 off-reef.

### Symbology

Two things have to be readable at a glance from a moving boat, so they use two
separate channels:

| Channel | Meaning |
|---|---|
| Ring colour | Which datasheet the point needs — amber `#e9a13b` on-reef, cyan `#4db6d0` off-reef |
| Fill | Sampled (solid green `#35b37e`) or still outstanding (hollow) |

A sampled point therefore still says which kind it was, and a crew scanning for
what is left sees hollow rings regardless of type. Point numbers label the dots
from zoom 15.5, which is where they stop overlapping.

### The form

Tapping a point opens its datasheet. Which fields appear is decided entirely by
the point's reef type — the same fork TPWD's two worksheets use:

- **On-reef** — counts for live oysters 6–25 mm and > 25 mm, oyster shells
  > 25 mm, and black oyster shells > 25 mm.
- **Off-reef** — presence of live oysters, Y/N.
- **Both** — seagrass Y/N, the mud/sand/shell-hash split, a photo, and notes.

Sized for a tablet on a deck: every control clears 44px, counts have stepper
keys either side so a wet finger never has to hit a caret, the yes/no questions
are a pair of keys rather than a select, and all inputs are 16px because
anything smaller makes iOS zoom the page on focus.

### Sediment composition

The three sediment shares are set with one proportional bar carrying two
draggable dividers, not three number boxes that have to be kept in agreement.

The state is the two **cut points**; mud, sand and shell hash are read off as
the widths between them. Three whole numbers totalling 100 is therefore the
only thing the control *can* produce — so the "must total 100%" failure the
paper datasheet invites does not exist here. There is no running total to
watch, because there is never anything to correct.

Dragging snaps to 5%, which is about the real precision of the act: someone
eyeballing the contents of a dredge is not distinguishing 47% from 48% mud.
Arrow keys move a divider by 5, shift-arrow by 1. The number boxes underneath
still take any whole number, and when one is typed the other two absorb the
remainder while keeping their ratio to each other — so setting mud to 75 does
not silently decide the rest is all sand. They settle on blur rather than on
every keystroke, so the neighbours do not jump around mid-type.

An untouched bar renders hatched and unset, because a bar pre-filled with a
plausible split would put an answer on the datasheet that nobody gave.

The arithmetic lives in `lib/sediment.ts`, apart from the control, so the
invariant can be tested directly rather than inspected. Both functions hold it
structurally: `fromCuts` rounds the cuts *before* taking differences, and
`rebalance` rounds only one of the two remaining shares and derives the other
by subtraction, so rounding cannot break either.

None of that replaces the CHECK constraint in `survey_schema.sql` or the check
in `validateDraft`. The widget makes the error unreachable through the UI;
those two are what make it impossible.

### Position

Every sample carries two positions: the coordinate TPWD **assigned**, and the
**actual** GPS fix at the time of sampling with the accuracy the device
reported. A standard dredge tow covers ~132 linear feet, so the boat is never
exactly on the mark; the form shows the distance between the two and warns past
150 ft, as a prompt rather than a block. The map also has a live position
control (blue dot with accuracy circle) for steering to the next point.

### Setting it up

```bash
npm run survey   # workbook -> data/survey_points.json + supabase/survey_seed.sql
```

Then in the Supabase SQL editor run `supabase/survey_schema.sql` once, followed
by `supabase/survey_seed.sql`. The seed is re-runnable: it refreshes the
assignment on conflict and never touches collected samples, so re-run it
whenever TPWD sends the next batch of points.

### How it is wired

Unlike `col_applications` — reached only by this app's API routes holding the
service-role key — survey reads and writes go **straight to Supabase from the
browser** as the signed-in surveyor, governed by the RLS policies in
`survey_schema.sql`. That is the same trust model as the polling layer, and it
is what lets a photo go from the tablet to Storage without a several-megabyte
round trip through the Next.js server on a boat's connection. The identity is
the site-wide one, so `recorded_by` is whoever signed in at `/login` — there is
no separate survey sign-in to forget.

Notable schema decisions:

- `survey_samples` carries a **copy of `reef_type`** pinned to the point's own
  value by a composite foreign key. A CHECK constraint cannot reach into
  another table, and this is what lets the database enforce that an on-reef row
  actually carries the four counts and an off-reef row carries the presence
  flag — not just the form.
- `recorded_by` is stamped from the JWT by a trigger, not trusted from the
  request body, so a client cannot file a sample under someone else's name.
- **One row per point.** Re-recording is a correction, which keeps the map's
  sampled/not-sampled state unambiguous.
- **No delete policy and no delete grant.** A collected sample is a regulatory
  record — amend it, do not remove it.
- Photos live in a private `survey-photos` bucket, named
  `<app#>-<point>-<timestamp>.jpg` so the filename says which sample it belongs
  to, and downscaled to 2048px before upload.

### Getting the data back out

```
/api/survey/csv?type=on&site=75    one worksheet's worth, exact columns
/api/survey/csv?type=off           every site, plus App# and actual position
```

The single-site form reproduces TPWD's `Datasheet.xlsx` columns **verbatim**,
including its inconsistent spacing around the size thresholds (`(>25 mm)` on
one row, `(>25mm)` on the next). Those are not tidied up on purpose — the file
is meant to drop into the workbook they sent, and a "corrected" header is a
column their sheet does not recognise.

Rows follow the *assignment*, not the collection: every assigned point appears,
and one not yet sampled comes through with its coordinate and empty observation
cells. A sheet that silently omitted outstanding points would read as a
complete survey.

### Known limitation: no offline mode

This is **online-only**. A submission needs a live connection, and there is no
local queue — if there is no signal at a point, the form cannot be saved and
the crew has to record it another way and enter it later. Coverage out at
Hanna's Reef is not guaranteed, so this is the thing most likely to bite.

Everything a submission needs goes through a single function, `saveSample` in
`lib/survey.ts`, specifically so that adding an IndexedDB queue later means
changing that one function and nothing that calls it.

## Reference layers

Restoration areas, and any other blocker type that is context rather than a COL
application, are grouped into **categories**. A category is one blocker type:
everything in it shares a colour and one buffer distance, and it arrives as a
single combined GeoJSON.

Categories are declared in `layers.config.json`:

```json
"categories": {
  "restoration-area": { "label": "Restoration area", "color": "#4db6d0", "bufferFeet": 500 }
},
"layers": {
  "hannas-reef-permit-area": "restoration-area",
  "coastal-lease-polygon-c-tcms": "restoration-area"
}
```

To add a source, drop the shapefile anywhere in the repo, add one line under
`layers` mapping its slug to a category, and run:

```bash
npm run layers
```

It reprojects to WGS84, strips Z, simplifies to about a metre, rounds to six
decimals, and writes one GeoJSON per category into `public/layers/` with an
`index.json` the map reads at runtime. No code changes per layer. A new
blocker type is a new entry under `categories` — the slider and colour come
along for free.

Layers are fetched rather than bundled, so a large category never lands in the
JavaScript payload, and they sit behind the sign-in like everything else.
They draw *beneath* the leases so context never covers the thing being decided
on.

### Buffers

Each category has a buffer slider in the **Layers** control, 0–2000 ft, starting
at the category's `bufferFeet`. The ring is computed in the browser as the
slider moves rather than precomputed, so any distance is available.

Buffering all 294 restoration areas takes roughly 400 ms, which is far too slow
to sit behind a slider, so two things keep it responsive:

- **Only features overlapping the current view are buffered**, with the view
  padded by the buffer distance first so a blocker just off-screen still
  contributes the part of its ring that reaches on-screen. Zoomed in on a lease
  — the case that matters — that is a handful of shapes and the work is
  imperceptible.
- **Below zoom 10.5 buffers are neither drawn nor computed**, because a 500 ft
  ring is about a pixel wide there. That also skips the slowest case. The
  control says "Zoom in to see the buffer" when this applies.

Feature bounding boxes are computed once when a category loads; recomputing
them per slider tick would cost more than the buffering does.

## Notes

- The polling-points layer needs a real platform login, which this build had no
  account for, so the tiles themselves were never fetched here. The sign-in,
  its error handling, the gating, and the colour expression were all verified;
  the drawing was confirmed in use rather than in test.
- `mvt_polling_points` returns an empty tile for the service role even on a tile
  holding 111 known points, while `mvt_leases_base` returns data on that same
  tile. That is the per-user filtering doing its job — without a signed-in user
  there is nothing to show.
- The platform's own field map reaches these tiles through an edge function
  (`/functions/v1/tiles/polling_points/{z}/{x}/{y}.pbf?year=`) rather than the
  RPC used here. Either works; the edge function returns protobuf directly and
  would remove the base64 decode step if this ever needs simplifying.

- `data/applications.json` is the import pipeline's base, not a mirror of the
  database. Once statuses or shapes are edited in the app the two diverge, and
  the app, the GeoJSON export, and the CSV export all read the database. Re-run
  `npm run extract` only when re-importing a workbook, not to refresh a
  snapshot.

- The GLO coastal lease set carries mixed `GLO_ID` prefixes — SL 227, CL 39,
  LC 16, CE 9, ME 1, SD 1 — which look like different lease types. They are all
  in `restoration-area` for now; splitting them into separate blocker
  categories is a config change, not a code change.
- `SL20200039`, cited in the modification comments for applications 16, 27 and
  109, is present in that set. `SL20200056` and `SL20260056`, also cited, are
  not.

- `hannahs_reef/` holds `East Redfish Permit Area.shx` with no `.shp` or
  `.dbf`. An `.shx` is only an index into the geometry file, so the shape
  cannot be recovered from it. Its header does record that the missing feature
  is a single PolygonZ spanning lon -94.834198..-94.808020, lat
  29.483861..29.502939. The importer skips it and says so.

- Acreage is computed from the ring by spherical excess on the WGS84 authalic
  radius. It agrees with the acreages in the source workbook within 0.5% for 75
  of the 78 applications. The exceptions are source discrepancies rather than
  arithmetic: application 91 is recorded as 76.71 ac against a computed 54.98,
  and applications 27 and 109 carry a `New acreage` about 7% away from the
  modified ring they were given. Because of this a freshly opened editor can
  show a small delta before anything is changed.
- A reshape is re-validated on the server, not just in the browser: fewer than
  three corners, a ring that crosses itself, or a corner that is not a finite
  `[longitude, latitude]` pair is refused with a 422 or 400. Rings are stored
  closed and wound counter-clockwise regardless of how they were entered.

- NOAA's older RNC tile service (`tileservice.charts.noaa.gov`) still resolves
  in DNS but no longer answers, so the chart basemap uses their Maritime Chart
  Service WMS instead.
- The `Justin` and `Johny` tabs in the workbook are group-filtered copies of
  `GIS Upload`, so only `GIS Upload` is read.
