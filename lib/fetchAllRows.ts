/**
 * Every row of a query, not just the first page.
 *
 * Supabase's API (PostgREST) returns at most `max_rows` rows per request —
 * 1,000 on a default project — and it does so silently: no error, no flag,
 * just a shorter array. A plain `.select("*")` therefore looks correct right up
 * until a table crosses the limit. That is what happened to the survey when the
 * third Galveston batch took it to 1,857 points: the map drew the first 1,000
 * in (app_no, point_no) order and quietly dropped ten sites, and the datasheet
 * exports would have left their rows out.
 *
 * So anything that must see a whole table goes through here. The caller builds
 * the query for a row range; this keeps asking until it has every row.
 *
 * Two rules for callers:
 *
 *  - Order by something unique — a primary key, or all of a composite one.
 *    Ranges over an unstable order can skip or repeat rows between pages.
 *  - Ask for `{ count: "exact" }` in the select. With the total known, the loop
 *    stops as soon as it has everything; without it, it stops at the first
 *    empty page, which is still correct but costs one more request.
 *
 * It advances by the rows actually returned rather than by the size it asked
 * for, so it stays correct even if the project's max_rows is set lower than
 * PAGE_SIZE — a short page is never taken to mean the end.
 */

/** Rows asked for per request: the default cap, so each page is one request. */
export const PAGE_SIZE = 1000;

type Page<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;

  for (;;) {
    const from = rows.length;
    const { data, error, count } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (typeof count === "number") total = count;

    const batch = data ?? [];
    rows.push(...batch);

    if (batch.length === 0) return rows;
    if (total !== null && rows.length >= total) return rows;
  }
}
