import type { CounterSpec } from './types.ts';

interface CounterBarProps {
  counters?: Record<string, number>;
  spec?: CounterSpec[];
}

/**
 * The comparison / swap / allocation readout.
 *
 * This is the primitive that does the most pedagogical work on the whole site.
 * "Merge sort is O(n log n)" is a claim a reader accepts or doesn't. A counter
 * that reads `comparisons: 47 · n log₂n ≈ 53` while they watch is an argument
 * they can check — and it makes the constant factor, the thing Big-O throws
 * away, visible at the same time.
 */
export function CounterBar({ counters, spec }: CounterBarProps) {
  if (!counters || Object.keys(counters).length === 0) return null;

  const entries = spec
    ? spec.filter((s) => s.key in counters)
    : Object.keys(counters).map((key) => ({ key, label: key }) as CounterSpec);

  return (
    <dl className="viz-counters" aria-live="polite">
      {entries.map(({ key, label, expected }) => (
        <div className="viz-counters__item" key={key}>
          <dt>{label}</dt>
          <dd>
            <span className="viz-counters__value">{counters[key] ?? 0}</span>
            {expected && (
              <span className="viz-counters__expected">
                {' · '}
                {expected.label} ≈ {Math.round(expected.value)}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
