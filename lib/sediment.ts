/**
 * The arithmetic behind the sediment bar, kept separate from the control so
 * the one property that matters can be tested directly: whatever goes in, the
 * three shares that come out are whole numbers totalling exactly 100.
 *
 * fromCuts guarantees that structurally rather than by checking afterwards:
 *
 *   mud = lo, sand = hi - lo, shell = 100 - hi
 *   -> lo + (hi - lo) + (100 - hi) === 100, for any lo <= hi
 *
 * Rounding cannot break it, because the cuts are rounded *before* the
 * differences are taken.
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
