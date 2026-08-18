/**
 * A request's time budget, broken into spans, with one span draggable.
 *
 * The baseline durations are not invented round numbers. `db` and `cache` are
 * genuine small operations of the kind captured for the incident fixtures
 * (`traces/incidents.ts`) at rest; `downstream` starts at 3000ms, which is
 * the exact p95 this repository captured for real from the `slow-dependency`
 * fault (see `scripts/capture-incidents/captures/slow-dependency.json`). The
 * lesson this widget exists to make concrete: shaving milliseconds off a fast
 * span is arithmetically irrelevant next to the one slow span, and the
 * reader can prove that to themselves by dragging it.
 */

export interface Span {
  name: string;
  ms: number;
  /** Whether this span's duration can be dragged in the widget. */
  adjustable: boolean;
}

export const BASELINE_SPANS: Span[] = [
  { name: 'gateway', ms: 2, adjustable: false },
  { name: 'auth', ms: 3, adjustable: false },
  { name: 'cache lookup', ms: 1, adjustable: false },
  { name: 'db query', ms: 16, adjustable: false },
  { name: 'downstream call', ms: 3000, adjustable: true },
  { name: 'serialize response', ms: 2, adjustable: false },
];

export interface BudgetResult {
  spans: Span[];
  totalMs: number;
  /** Each span's share of the total, for the waterfall bar widths. */
  shares: number[];
  dominantSpan: string;
  dominantShare: number;
}

export function computeBudget(spans: Span[]): BudgetResult {
  const totalMs = spans.reduce((sum, s) => sum + s.ms, 0);
  const shares = spans.map((s) => (totalMs === 0 ? 0 : s.ms / totalMs));
  let dominantIndex = 0;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.ms > spans[dominantIndex]!.ms) dominantIndex = i;
  }
  return {
    spans,
    totalMs,
    shares,
    dominantSpan: spans[dominantIndex]?.name ?? '',
    dominantShare: shares[dominantIndex] ?? 0,
  };
}

/**
 * What shaving `deltaMs` off the *fastest fixed* span does to the total,
 * versus what the same `deltaMs` shaved off the adjustable span does.
 *
 * This is the arithmetic the page's practice problem is built on: the same
 * optimisation effort produces a wildly different result depending only on
 * which span it targets.
 */
export function compareOptimisations(spans: Span[], deltaMs: number) {
  const before = computeBudget(spans).totalMs;

  const fixed = [...spans].filter((s) => !s.adjustable);
  const fastestFixed = fixed.reduce((a, b) => (b.ms < a.ms ? b : a));
  const afterOptimisingFixed = spans.map((s) =>
    s.name === fastestFixed.name ? { ...s, ms: Math.max(0, s.ms - deltaMs) } : s,
  );

  const adjustable = spans.find((s) => s.adjustable)!;
  const afterOptimisingAdjustable = spans.map((s) =>
    s.name === adjustable.name ? { ...s, ms: Math.max(0, s.ms - deltaMs) } : s,
  );

  return {
    before,
    afterOptimisingFastestFixed: computeBudget(afterOptimisingFixed).totalMs,
    afterOptimisingAdjustable: computeBudget(afterOptimisingAdjustable).totalMs,
    targetOfFixedOptimisation: fastestFixed.name,
  };
}
