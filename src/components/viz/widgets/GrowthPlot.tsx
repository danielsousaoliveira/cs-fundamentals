import { useId, useMemo, useState } from 'react';
import { VizFrame } from '../core/index.ts';

/**
 * The complexity page's centrepiece.
 *
 * Most growth-rate charts draw the textbook curves with all constants set to 1,
 * which quietly teaches the wrong lesson: that a lower complexity class is always
 * the faster program. This one puts the constant factor on a slider, so the
 * crossover point moves while you watch — and you can find the `n` below which
 * the "worse" algorithm genuinely wins.
 *
 * That is the honest version of what Big-O says: it describes the shape of the
 * curve as n grows, and says nothing whatsoever about where you actually sit on it.
 */

interface Curve {
  key: string;
  label: string;
  /** Cost of the algorithm at size n, including its constant factor. */
  f: (n: number, c: number) => number;
  /** Which constant slider drives this curve, if any. */
  usesConstant?: boolean;
  color: string;
}

const CURVES: Curve[] = [
  {
    key: 'log',
    label: 'O(log n)',
    f: (n) => Math.log2(Math.max(n, 1)),
    color: 'var(--viz-role-sorted-border)',
  },
  { key: 'n', label: 'O(n)', f: (n) => n, color: 'var(--viz-role-active-border)' },
  {
    key: 'nlogn',
    label: 'c · O(n log n)',
    f: (n, c) => c * n * Math.log2(Math.max(n, 2)),
    usesConstant: true,
    color: 'var(--viz-role-compare-border)',
  },
  { key: 'n2', label: 'O(n²)', f: (n) => n * n, color: 'var(--viz-role-swap-border)' },
];

const WIDTH = 560;
const HEIGHT = 300;
const PAD = { left: 52, right: 16, top: 14, bottom: 34 };

export function GrowthPlot() {
  const [maxN, setMaxN] = useState(100);
  const [constant, setConstant] = useState(12);
  const [logScale, setLogScale] = useState(false);
  const clipId = useId();

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const { paths, maxY, crossover } = useMemo(() => {
    const samples = 160;
    const xs = Array.from({ length: samples + 1 }, (_, i) => (i / samples) * maxN);

    const series = CURVES.map((curve) => ({
      curve,
      points: xs.map((x) => [x, curve.f(x, constant)] as const),
    }));

    const maxY = Math.max(...series.flatMap((s) => s.points.map(([, y]) => y)), 1);

    const scaleY = (y: number) =>
      logScale
        ? plotH - (Math.log10(Math.max(y, 1)) / Math.log10(Math.max(maxY, 10))) * plotH
        : plotH - (y / maxY) * plotH;

    const paths = series.map(({ curve, points }) => ({
      curve,
      d: points
        .map(
          ([x, y], i) =>
            `${i === 0 ? 'M' : 'L'} ${((x / maxN) * plotW).toFixed(2)} ${scaleY(y).toFixed(2)}`,
        )
        .join(' '),
    }));

    // Where does c·n log n stop being cheaper than n²? Solve c·log₂n = n.
    let crossover: number | null = null;
    for (let n = 2; n <= 100000; n++) {
      if (n * n > constant * n * Math.log2(n)) {
        crossover = n;
        break;
      }
    }

    return { paths, maxY, crossover };
  }, [maxN, constant, logScale, plotW, plotH]);

  const nlogn = constant * maxN * Math.log2(Math.max(maxN, 2));
  const nsq = maxN * maxN;

  return (
    <VizFrame
      title="Growth rates, with the constant factor visible"
      intro="Drag n to change the range. Drag c to change how expensive each step of the O(n log n) algorithm is — and watch where the two curves cross."
      caption={
        crossover === null
          ? `With c = ${constant}, n² never overtakes c·n log n in a useful range.`
          : `With c = ${constant}, the O(n²) algorithm is genuinely faster for every n below ${crossover}. ` +
            `Above it, the asymptotics take over and never give the lead back.`
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="growth-plot"
        role="img"
        aria-label={`Growth rate curves up to n = ${maxN}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        <g transform={`translate(${PAD.left} ${PAD.top})`}>
          <line className="growth-plot__axis" x1={0} y1={plotH} x2={plotW} y2={plotH} />
          <line className="growth-plot__axis" x1={0} y1={0} x2={0} y2={plotH} />

          <g clipPath={`url(#${clipId})`}>
            {paths.map(({ curve, d }) => (
              <path
                key={curve.key}
                d={d}
                className="growth-plot__curve"
                style={{ stroke: curve.color }}
              />
            ))}
          </g>

          <text className="growth-plot__axis-label" x={plotW / 2} y={plotH + 26}>
            n → {maxN}
          </text>
          <text
            className="growth-plot__axis-label"
            transform={`translate(-38 ${plotH / 2}) rotate(-90)`}
          >
            {logScale ? 'work (log scale)' : 'work'}
          </text>
        </g>
      </svg>

      <ul className="growth-plot__legend">
        {CURVES.map((curve) => (
          <li key={curve.key}>
            <span
              className="growth-plot__swatch"
              style={{ background: curve.color }}
              aria-hidden="true"
            />
            {curve.label}
            {curve.usesConstant && <> (c = {constant})</>}
          </li>
        ))}
      </ul>

      <div className="growth-plot__controls">
        <label>
          <span>
            n = <strong>{maxN}</strong>
          </span>
          <input
            type="range"
            min={10}
            max={2000}
            step={10}
            value={maxN}
            onChange={(e) => setMaxN(Number(e.target.value))}
          />
        </label>

        <label>
          <span>
            c = <strong>{constant}</strong>
          </span>
          <input
            type="range"
            min={1}
            max={60}
            value={constant}
            onChange={(e) => setConstant(Number(e.target.value))}
          />
        </label>

        <label className="growth-plot__toggle">
          <input
            type="checkbox"
            checked={logScale}
            onChange={(e) => setLogScale(e.target.checked)}
          />
          <span>log scale</span>
        </label>
      </div>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>at n = {maxN}</dt>
          <dd>
            <span className="viz-counters__value">
              {Math.round(nlogn).toLocaleString()}
            </span>
            <span className="viz-counters__expected"> steps for c·n log n</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>vs</dt>
          <dd>
            <span className="viz-counters__value">{nsq.toLocaleString()}</span>
            <span className="viz-counters__expected">
              {' '}
              for n² — {(nsq / nlogn).toFixed(1)}× more
            </span>
          </dd>
        </div>
      </dl>
    </VizFrame>
  );
}
