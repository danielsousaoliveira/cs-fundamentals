// Reads the raw captures in scripts/capture-incidents/captures/*.json (real
// telemetry from a real Node process, six of them genuinely faulted, one a
// clean baseline) and emits a compact typed fixture the browser ships.
//
// Mirrors scripts/distil-query-plans.py: keep the full raw capture out of
// the repo's shipped bundle, keep the emitted numbers real.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = path.join(__dirname, 'capture-incidents', 'captures');
const OUT_FILE = path.join(
  __dirname,
  '..',
  'src',
  'components',
  'viz',
  'traces',
  'fixtures',
  'incidents.ts',
);

const files = readdirSync(CAPTURES_DIR).filter((f) => f.endsWith('.json'));

const fixtures = files.map((f) => {
  const data = JSON.parse(readFileSync(path.join(CAPTURES_DIR, f), 'utf8'));
  const t0 = data.samples[0]?.ts ?? 0;
  const samples = data.samples.map((s) => ({
    t_s: Math.round((s.ts - t0) / 100) / 10,
    rss_mb: s.rss_mb,
    cpu_pct: s.cpu_pct,
    rps: s.rps,
    p50_ms: s.p50_ms,
    p95_ms: s.p95_ms,
    p99_ms: s.p99_ms,
    in_flight: s.in_flight,
    pool_waiting: s.pool_waiting,
    error_rate: Math.round(s.error_rate * 1000) / 1000,
    downstream_rps: s.downstream_rps,
    downstream_429_rate: Math.round(s.downstream_429_rate * 1000) / 1000,
  }));
  return {
    fault: data.fault,
    samples,
    containerState: data.containerState ?? null,
  };
});

const header = `/**
 * Real telemetry captured from a real Node HTTP service, deliberately faulted
 * six different ways, one baseline. Captured with
 * \`scripts/capture-incidents/capture.cjs\` (Node's built-in http server, no
 * framework) and a real concurrent load driver
 * (\`scripts/capture-incidents/load.cjs\`), sampled once a second from a real
 * \`/metrics\` endpoint. The memory-leak fixture ran inside a real Docker
 * container capped at 200 MB (\`--memory=200m\`) and was genuinely OOMKilled by
 * the kernel -- \`containerState.OOMKilled\` and \`.ExitCode: 137\` below are
 * copied verbatim from \`docker inspect\`, not invented.
 *
 * Regenerate with \`node scripts/distil-incidents.mjs\` after
 * \`node scripts/capture-incidents/capture.cjs <fault>\`.
 *
 * The property this fixture set exists to demonstrate: slow-dependency and
 * cpu-bound produce near-identical latency curves and opposite CPU curves --
 * the single fact the whole 14-production section is built around.
 */

export interface IncidentSample {
  t_s: number;
  rss_mb: number;
  cpu_pct: number;
  rps: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  in_flight: number;
  pool_waiting: number;
  error_rate: number;
  downstream_rps: number;
  downstream_429_rate: number;
}

export interface ContainerState {
  Status: string;
  Running: boolean;
  Paused: boolean;
  Restarting: boolean;
  OOMKilled: boolean;
  Dead: boolean;
  Pid: number;
  ExitCode: number;
  Error: string;
  StartedAt: string;
  FinishedAt: string;
}

export interface IncidentFixture {
  fault: string;
  samples: IncidentSample[];
  containerState: ContainerState | null;
}

export const INCIDENT_FIXTURES: IncidentFixture[] = `;

writeFileSync(OUT_FILE, header + JSON.stringify(fixtures, null, 2) + ';\n');
console.log(
  `wrote ${fixtures.length} fixtures (${fixtures.reduce((n, f) => n + f.samples.length, 0)} samples) to ${OUT_FILE}`,
);
