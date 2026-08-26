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

Then add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under **Settings →
Environment Variables** and redeploy. No other configuration is needed.

### Locking down edits

By default anyone with the URL can change a status. Set an `EDIT_PASSCODE`
environment variable to require a shared passcode; the app asks for it once and
remembers it in that browser. Leave it unset to keep edits open.

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
JavaScript payload, and they sit behind the site passcode like everything else.
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
