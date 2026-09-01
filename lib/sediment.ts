/**
 * The arithmetic behind the sediment bar, kept separate from the control so
 * the one property that matters can be tested directly: whatever goes in, the
 * three shares that come out are whole numbers totalling exactly 100.
 *
 * Both functions guarantee that structurally rather than by checking
 * afterwards:
 *
 *   fromCuts   mud = lo, sand = hi - lo, shell = 100 - hi
 *              -> lo + (hi - lo) + (100 - hi) === 100, for any lo <= hi
 *
 *   rebalance  the typed share is taken out and the remainder is split, so the
 *              parts are 100 - rest and rest by construction
 *
 * Rounding cannot break either: fromCuts rounds the cuts *before* taking
 * differences, and rebalance rounds only one of the two remaining shares and
 * derives the other by subtraction.
 */

export type Shares = { mud: number; sand: number; shellHash: number };
export type ShareKey = keyof Shares;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** A finite integer in 0..100; anything else becomes 0. */
const whole = (value: number) =>
  Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 0;

/**
 * Two cut points on a 0..100 bar -> the three shares between them.
 * `hi` is floored at `lo`, so a divider dragged past its neighbour collapses
 * that share to zero rather than producing a negative one.
 */
export function fromCuts(cut1: number, cut2: number): Shares {
  const lo = whole(cut1);
  const hi = clamp(whole(cut2), lo, 100);
  return { mud: lo, sand: hi - lo, shellHash: 100 - hi };
}

/** The inverse: where the two dividers sit for a given set of shares. */
export function toCuts(shares: Shares): [number, number] {
  return [shares.mud, shares.mud + shares.sand];
}

const KEYS: ShareKey[] = ["mud", "sand", "shellHash"];

/**
 * One share typed directly; the other two absorb what is left.
 *
 * They keep their ratio to each other, so setting mud to 75 does not silently
 * decide the rest is all sand. When both are zero there is no ratio to keep
 * and the remainder is split evenly.
 */
export function rebalance(current: Shares, key: ShareKey, typed: number): Shares {
  const value = whole(typed);
  const [a, b] = KEYS.filter((k) => k !== key) as [ShareKey, ShareKey];

  const rest = 100 - value;
  const pool = current[a] + current[b];
  const share = pool <= 0 ? Math.round(rest / 2) : Math.round((rest * current[a]) / pool);

  return {
    ...current,
    [key]: value,
    [a]: share,
    [b]: rest - share,
  } as Shares;
}
