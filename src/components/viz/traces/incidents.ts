/**
 * Six real incidents, replayed.
 *
 * Every number here came from `scripts/capture-incidents/` — a real Node HTTP
 * server, genuinely faulted six different ways, hit with real concurrent
 * traffic, sampled once a second from a real `/metrics` endpoint. The
 * memory-leak fixture was genuinely OOMKilled by the Linux kernel inside a
 * Docker container capped at 200 MB; `containerState.ExitCode: 137` is copied
 * verbatim from `docker inspect`, not invented.
 *
 * This module does no simulation. It reads the captured time series and
 * derives the things a reader needs to form and test a hypothesis: which
 * signal moved, by how much, and what that combination of signals rules in
 * or out. See `INCIDENT_FIXTURES` in `./fixtures/incidents.ts` for the raw
 * captured samples.
 */

import {
  INCIDENT_FIXTURES,
  type IncidentFixture,
  type IncidentSample,
} from './fixtures/incidents.ts';

export type FaultName =
  | 'none'
  | 'cpu-bound'
  | 'slow-dependency'
  | 'pool-exhaustion'
  | 'retry-storm'
  | 'load-spike'
  | 'memory-leak';

export const FAULTS: { name: FaultName; label: string; summary: string }[] = [
  { name: 'none', label: 'baseline', summary: 'Normal traffic, no fault.' },
  {
    name: 'cpu-bound',
    label: 'CPU-bound work',
    summary: 'A real synchronous SHA-256 loop blocking the event loop.',
  },
  {
    name: 'slow-dependency',
    label: 'slow dependency',
    summary: 'A real 3s async wait, standing in for a slow downstream call.',
  },
  {
    name: 'pool-exhaustion',
    label: 'pool exhaustion',
    summary: 'A 5-slot worker pool fed 2s operations under 15-way concurrency.',
  },
  {
    name: 'retry-storm',
    label: 'retry storm',
    summary: 'A flaky downstream returning 429, retried with no backoff.',
  },
  {
    name: 'load-spike',
    label: 'load spike',
    summary: 'The baseline server under real high-concurrency traffic.',
  },
  {
    name: 'memory-leak',
    label: 'memory leak',
    summary: 'A real 5 MB retained allocation per request, capped at 200 MB.',
  },
];

export function fixtureFor(fault: FaultName): IncidentFixture {
  const fixture = INCIDENT_FIXTURES.find((f) => f.fault === fault);
  if (!fixture) throw new Error(`no captured fixture for fault '${fault}'`);
  return fixture;
}

export interface Stats {
  peakCpuPct: number;
  peakP95Ms: number;
  peakRss: number;
  peakPoolWaiting: number;
  peakDownstreamRps: number;
  baselineCpuPct: number;
}

/** Summary stats over the whole captured window -- used for the sparkline scale and the verdict text. */
export function statsFor(samples: IncidentSample[]): Stats {
  return {
    peakCpuPct: Math.max(...samples.map((s) => s.cpu_pct)),
    peakP95Ms: Math.max(...samples.map((s) => s.p95_ms)),
    peakRss: Math.max(...samples.map((s) => s.rss_mb)),
    peakPoolWaiting: Math.max(...samples.map((s) => s.pool_waiting)),
    peakDownstreamRps: Math.max(...samples.map((s) => s.downstream_rps)),
    baselineCpuPct: samples[0]?.cpu_pct ?? 0,
  };
}

export interface VerdictStep {
  narrowedTo: string[];
  eliminated: string[];
  headline: string;
}

/**
 * What a reader watching the dashboard live, evidence arriving one sample at
 * a time, could reasonably conclude by this point in the captured window.
 *
 * This is the whole pedagogical point of the widget: at t=0 almost every
 * hypothesis is still open, and each additional real sample either confirms
 * or eliminates one. The narrowing sequence is derived from the fixture's
 * own measured thresholds (a CPU peak above 70% rules out "waiting"), not
 * scripted per fault.
 */
export function verdictAt(
  fault: FaultName,
  samples: IncidentSample[],
  index: number,
): VerdictStep {
  const upTo = samples.slice(0, index + 1);
  const s = statsFor(upTo);
  const eliminated: string[] = [];
  const narrowedTo: string[] = [];

  const latencyUp = s.peakP95Ms > 300;
  const cpuHigh = s.peakCpuPct > 70;
  const cpuFlat = index > 1 && s.peakCpuPct < 25;

  if (!latencyUp) {
    return {
      narrowedTo: ['nothing conclusive yet'],
      eliminated: [],
      headline: 'p95 latency still near baseline -- no fault confirmed yet.',
    };
  }

  if (cpuHigh) {
    eliminated.push('waiting on a dependency (CPU would be flat, not pegged)');
    eliminated.push('connection pool exhaustion (same reason)');
    narrowedTo.push('CPU-bound work on this process');
  } else if (cpuFlat) {
    eliminated.push('a CPU-bound bug in this process (CPU is flat, not pegged)');
    if (s.peakPoolWaiting > 3) {
      narrowedTo.push(
        'the process is waiting on a bounded resource (pool/connections)',
      );
    } else if (s.peakDownstreamRps > 500) {
      narrowedTo.push('a retry loop multiplying calls to a downstream dependency');
    } else {
      narrowedTo.push('the process is waiting on a slow external dependency');
    }
  }

  const headline =
    narrowedTo.length > 0
      ? `Latency is up and CPU is ${cpuHigh ? 'pegged' : 'flat'} -- ${narrowedTo[0]}.`
      : 'Latency moved; not enough evidence yet to separate the remaining hypotheses.';

  return { narrowedTo, eliminated, headline };
}

export { type IncidentFixture, type IncidentSample };
