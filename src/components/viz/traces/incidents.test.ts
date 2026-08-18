import { describe, expect, it } from 'vitest';
import { FAULTS, fixtureFor, statsFor, verdictAt } from './incidents.ts';

describe('captured fixtures', () => {
  it('has a fixture for every declared fault', () => {
    for (const { name } of FAULTS) {
      expect(() => fixtureFor(name)).not.toThrow();
    }
  });

  it('every fixture has at least ten real samples', () => {
    for (const { name } of FAULTS) {
      expect(fixtureFor(name).samples.length).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('the signature the whole section is built around', () => {
  it('cpu-bound peaks CPU above 85%, captured for real', () => {
    const stats = statsFor(fixtureFor('cpu-bound').samples);
    expect(stats.peakCpuPct).toBeGreaterThan(85);
  });

  it('slow-dependency never exceeds 25% CPU while latency is far above baseline', () => {
    const samples = fixtureFor('slow-dependency').samples;
    const stats = statsFor(samples);
    expect(stats.peakCpuPct).toBeLessThan(25);
    expect(stats.peakP95Ms).toBeGreaterThan(2000);
  });

  it('slow-dependency and cpu-bound both show real latency well above baseline', () => {
    const slow = statsFor(fixtureFor('slow-dependency').samples);
    const cpu = statsFor(fixtureFor('cpu-bound').samples);
    expect(slow.peakP95Ms).toBeGreaterThan(500);
    expect(cpu.peakP95Ms).toBeGreaterThan(500);
    // The point of the fixture pair: near-identical latency, opposite CPU.
    expect(cpu.peakCpuPct - slow.peakCpuPct).toBeGreaterThan(60);
  });
});

describe('pool-exhaustion', () => {
  it('CPU stays flat while the pool queue backs up', () => {
    const stats = statsFor(fixtureFor('pool-exhaustion').samples);
    expect(stats.peakCpuPct).toBeLessThan(10);
    expect(stats.peakPoolWaiting).toBeGreaterThan(3);
  });

  it('p95 latency grows across the captured window as the queue backs up', () => {
    const samples = fixtureFor('pool-exhaustion').samples;
    const nonZero = samples.filter((s) => s.p95_ms > 0);
    expect(nonZero[nonZero.length - 1]!.p95_ms).toBeGreaterThan(nonZero[0]!.p95_ms);
  });
});

describe('retry-storm', () => {
  it('downstream call volume is several times the upstream request rate', () => {
    const stats = statsFor(fixtureFor('retry-storm').samples);
    expect(stats.peakDownstreamRps).toBeGreaterThan(2000);
  });

  it('most downstream calls are genuinely rejected with 429', () => {
    const samples = fixtureFor('retry-storm').samples;
    const withTraffic = samples.filter((s) => s.downstream_rps > 0);
    expect(withTraffic.length).toBeGreaterThan(0);
    for (const s of withTraffic) {
      expect(s.downstream_429_rate).toBeGreaterThan(0.5);
    }
  });
});

describe('load-spike', () => {
  it('rps, latency, and queueing all rise together', () => {
    const samples = fixtureFor('load-spike').samples;
    const first = samples[0]!;
    const peak = statsFor(samples);
    expect(peak.peakPoolWaiting).toBeGreaterThan(first.pool_waiting);
    expect(peak.peakP95Ms).toBeGreaterThan(0);
  });
});

describe('memory-leak', () => {
  it('rss grows monotonically-ish across the captured ramp', () => {
    const samples = fixtureFor('memory-leak').samples;
    expect(samples[samples.length - 1]!.rss_mb).toBeGreaterThan(
      samples[0]!.rss_mb + 50,
    );
  });

  it('the container was genuinely OOMKilled -- copied from docker inspect, not asserted', () => {
    const fixture = fixtureFor('memory-leak');
    expect(fixture.containerState).not.toBeNull();
    expect(fixture.containerState!.OOMKilled).toBe(true);
    expect(fixture.containerState!.ExitCode).toBe(137);
  });
});

describe('verdictAt', () => {
  it('reaches no conclusion before latency has moved', () => {
    const samples = fixtureFor('none').samples;
    const v = verdictAt('none', samples, 0);
    expect(v.eliminated).toHaveLength(0);
  });

  it('eliminates waiting-on-a-dependency once cpu-bound shows pegged CPU', () => {
    const samples = fixtureFor('cpu-bound').samples;
    const lastIndex = samples.length - 1;
    const v = verdictAt('cpu-bound', samples, lastIndex);
    expect(v.eliminated.some((e) => e.includes('waiting'))).toBe(true);
  });

  it('eliminates a CPU-bound bug once slow-dependency shows flat CPU with high latency', () => {
    const samples = fixtureFor('slow-dependency').samples;
    const lastIndex = samples.length - 1;
    const v = verdictAt('slow-dependency', samples, lastIndex);
    expect(v.eliminated.some((e) => e.includes('CPU-bound'))).toBe(true);
  });
});
