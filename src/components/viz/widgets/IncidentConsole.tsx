import { useState } from 'react';
import { Scrubber, StepControls, VizFrame, useStepPlayer } from '../core/index.ts';
import type { VizStep } from '../core/types.ts';
import {
  FAULTS,
  fixtureFor,
  statsFor,
  verdictAt,
  type FaultName,
} from '../traces/incidents.ts';

/**
 * Six real incidents, replayed sample by sample.
 *
 * Every number on this dashboard was captured, not scripted -- see
 * `scripts/capture-incidents/README.md`. The widget's whole argument is the
 * contrast between `cpu-bound` and `slow-dependency`: play both and watch
 * latency climb almost identically while CPU does the opposite thing. That
 * contrast is the reason this section exists.
 */

interface IncidentStep extends VizStep {
  t_s: number;
  rss_mb: number;
  cpu_pct: number;
  rps: number;
  p95_ms: number;
  in_flight: number;
  pool_waiting: number;
  downstream_rps: number;
  downstream_429_rate: number;
}

function sparkline(values: number[], max: number, height = 36): string {
  if (values.length === 0) return '';
  const w = 100;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * step;
      const y = max === 0 ? height : height - (Math.min(v, max) / max) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function Sparkline({
  values,
  max,
  unit,
  danger,
}: {
  values: number[];
  max: number;
  unit: string;
  danger?: boolean;
}) {
  const path = sparkline(values, max);
  const current = values[values.length - 1] ?? 0;
  return (
    <div className="ic__spark">
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="ic__spark-svg">
        <path
          d={path}
          className={danger ? 'ic__spark-line--danger' : 'ic__spark-line'}
        />
      </svg>
      <span className="ic__spark-value">
        {Math.round(current * 10) / 10}
        {unit}
      </span>
    </div>
  );
}

export function IncidentConsole() {
  const [fault, setFault] = useState<FaultName>('slow-dependency');
  const fixture = fixtureFor(fault);
  const meta = FAULTS.find((f) => f.name === fault)!;
  const stats = statsFor(fixture.samples);

  const steps: IncidentStep[] = fixture.samples.map((s) => ({
    ...s,
    caption: `t=${s.t_s}s -- cpu ${s.cpu_pct}%, p95 ${s.p95_ms}ms, rss ${s.rss_mb}MB`,
  }));

  const player = useStepPlayer(steps, { interval: 500 });
  const upTo = steps.slice(0, player.index + 1);
  const verdict = verdictAt(fault, fixture.samples, player.index);

  function selectFault(name: FaultName) {
    setFault(name);
  }

  const cpuDanger = (player.step?.cpu_pct ?? 0) > 70;
  const poolDanger = (player.step?.pool_waiting ?? 0) > 3;

  return (
    <VizFrame
      title="Reading the dashboard during a real incident"
      intro="Pick a fault, step through the captured telemetry, and watch which hypotheses the evidence rules out."
      caption={meta.summary}
    >
      <div className="ic__faults" role="group" aria-label="Fault">
        {FAULTS.filter((f) => f.name !== 'none').map((f) => (
          <button
            key={f.name}
            type="button"
            className={`ic__fault${fault === f.name ? ' ic__fault--on' : ''}`}
            aria-pressed={fault === f.name}
            onClick={() => selectFault(f.name)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <StepControls player={player} />
      <Scrubber player={player} steps={steps} />

      <div className="ic__grid">
        <div className="ic__metric">
          <span className="ic__metric-label">CPU</span>
          <Sparkline
            values={upTo.map((s) => s.cpu_pct)}
            max={100}
            unit="%"
            danger={cpuDanger}
          />
        </div>
        <div className="ic__metric">
          <span className="ic__metric-label">p95 latency</span>
          <Sparkline
            values={upTo.map((s) => s.p95_ms)}
            max={Math.max(1, stats.peakP95Ms)}
            unit="ms"
          />
        </div>
        <div className="ic__metric">
          <span className="ic__metric-label">RSS</span>
          <Sparkline
            values={upTo.map((s) => s.rss_mb)}
            max={Math.max(1, stats.peakRss)}
            unit="MB"
          />
        </div>
        <div className="ic__metric">
          <span className="ic__metric-label">pool waiting</span>
          <Sparkline
            values={upTo.map((s) => s.pool_waiting)}
            max={Math.max(1, stats.peakPoolWaiting)}
            unit=""
            danger={poolDanger}
          />
        </div>
        {stats.peakDownstreamRps > 0 && (
          <div className="ic__metric">
            <span className="ic__metric-label">downstream rps</span>
            <Sparkline
              values={upTo.map((s) => s.downstream_rps)}
              max={Math.max(1, stats.peakDownstreamRps)}
              unit=""
              danger
            />
          </div>
        )}
      </div>

      <div className="ic__verdict">
        <p className="ic__verdict-headline">{verdict.headline}</p>
        {verdict.eliminated.length > 0 && (
          <ul className="ic__verdict-list">
            {verdict.eliminated.map((e, i) => (
              <li key={i} className="ic__verdict-eliminated">
                ruled out: {e}
              </li>
            ))}
          </ul>
        )}
      </div>

      {fault === 'memory-leak' &&
        fixture.containerState &&
        player.index === steps.length - 1 && (
          <p className="ic__warning">
            <code>docker inspect</code> on this container, verbatim: OOMKilled ={' '}
            <strong>{String(fixture.containerState.OOMKilled)}</strong>, exit code{' '}
            <strong>{fixture.containerState.ExitCode}</strong>.
          </p>
        )}
    </VizFrame>
  );
}
