# COL Status

A web map of the 78 TPWD Certificate of Location applications in
`Justin_Johny_COL_Status.xlsx`. Polygons are coloured by status, filterable by
owner, bay system, and reviewer, searchable by application number or name, and
each one's status can be changed in two taps from a phone or a desktop.

## What's here

| Path | What it does |
|------|--------------|
| `scripts/extract_xlsx.py` | Reads the workbook, validates every polygon, writes `data/applications.json` and `supabase/seed.sql` |
| `data/applications.json` | The 78 applications, shaped exactly like a database row |
| `supabase/schema.sql` | Table, status constraint, `updated_at` trigger, RLS lockdown |
| `supabase/seed.sql` | Re-runnable inserts for all 78 rows |
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
- **Basemaps** — *Chart* is NOAA's Maritime Chart Service, which shows charted
  reefs, depths, and the ICW, and is the default because that is the context
  these decisions are made in. *Satellite* and *Plain* are one tap away.

## Notes

- NOAA's older RNC tile service (`tileservice.charts.noaa.gov`) still resolves
  in DNS but no longer answers, so the chart basemap uses their Maritime Chart
  Service WMS instead.
- The `Justin` and `Johny` tabs in the workbook are group-filtered copies of
  `GIS Upload`, so only `GIS Upload` is read.
