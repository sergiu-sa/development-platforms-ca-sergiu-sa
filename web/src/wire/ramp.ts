/**
 * The wire's visual law: a story's size, width, weight and opacity all come
 * from one number - how far down the chronological list it sits.
 *
 * Rank drives the ramp rather than absolute age. Age alone degenerates: on a
 * busy morning all 63 stories land within two hours, the ramp barely moves and
 * the page flattens into a uniform list. Rank guarantees a gradient every time,
 * and freshness() below carries the honest passage of time separately.
 */
export interface Ramp {
  size: number;
  wdth: number;
  wght: number;
  opacity: number;
}

const SIZE_MAX = 74;
const SIZE_MIN = 11;
const WDTH_MAX = 125;
const WDTH_MIN = 62;
const WGHT_MAX = 800;
const WGHT_MIN = 300;
const CURVE = 0.7;

/**
 * The accessibility floor, and the reason it is exported: 11px ink at 0.40
 * opacity measures about 2.6:1 against paper, which fails WCAG AA. Recession
 * is carried by size, width and weight - all contrast-neutral - and opacity
 * only ever moves between 1 and this value.
 */
export const OPACITY_MIN = 0.72;

export function rampFor(rank: number, total: number): Ramp {
  const span = Math.max(total - 1, 1);
  const clamped = Math.min(Math.max(rank, 0), span);
  const e = Math.pow(clamped / span, CURVE);

  return {
    size: SIZE_MAX * Math.pow(SIZE_MIN / SIZE_MAX, e),
    wdth: WDTH_MAX + (WDTH_MIN - WDTH_MAX) * e,
    wght: WGHT_MAX + (WGHT_MIN - WGHT_MAX) * e,
    opacity: 1 + (OPACITY_MIN - 1) * e,
  };
}

const FRESH_HOURS = 12;

/**
 * How awake the wire is, 1 to 0, from the newest story's real age.
 *
 * Deliberately NOT applied to text opacity: multiplying it against the ramp
 * floor gives 0.72 x 0.88 = 0.63 and breaks the contrast rule. It drives the
 * signal colour's saturation and the hairline rules instead, so a stale wire
 * looks asleep without a single character losing contrast.
 */
export function freshness(newestMs: number, nowMs: number): number {
  const hours = Math.max(0, (nowMs - newestMs) / 3_600_000);
  return Math.max(0, 1 - hours / FRESH_HOURS);
}
