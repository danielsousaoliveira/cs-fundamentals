import { describe, expect, it } from 'vitest';
import {
  CORPUS,
  COSMOS_LIMITS,
  buildCorpus,
  distribute,
  fnv1a,
  KEYS,
  keyOf,
  isSinglePartitionQuery,
  routableQueries,
  throttlingThreshold,
  throughput,
  type KeyName,
} from './partitioning.ts';

const shareOf = (field: (d: (typeof CORPUS)[number]) => string) => {
  const counts = new Map<string, number>();
  for (const doc of CORPUS) counts.set(field(doc), (counts.get(field(doc)) ?? 0) + 1);
  return counts;
};

describe('the hash', () => {
  it('is deterministic', () => {
    expect(fnv1a('acme')).toBe(fnv1a('acme'));
    expect(fnv1a('acme')).not.toBe(fnv1a('globex'));
  });

  it('stays inside 32 bits', () => {
    for (const input of ['', 'a', 'acme', 'user-399', '2026-08-02', 'x'.repeat(500)]) {
      const hash = fnv1a(input);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('avalanches on a one-character change', () => {
    // The claim "a high-cardinality key spreads evenly" depends entirely on the
    // hash mixing. If neighbouring strings landed in neighbouring buckets, the
    // whole demonstration would be an artefact of a weak hash.
    const a = fnv1a('user-100') % 12;
    const different = ['user-101', 'user-102', 'user-103', 'user-104']
      .map((s) => fnv1a(s) % 12)
      .filter((bucket) => bucket !== a);
    expect(different.length).toBeGreaterThan(0);
  });

  it('spreads distinct values across all buckets', () => {
    const buckets = new Set(
      Array.from({ length: 400 }, (_, i) => fnv1a(`user-${i}`) % 12),
    );
    expect(buckets.size).toBe(12);
  });
});

describe('the corpus', () => {
  it('is deterministic across builds', () => {
    expect(buildCorpus(200)).toEqual(buildCorpus(200));
  });

  it('has one tenant far larger than the rest', () => {
    // Without a whale there is no lesson: every key would look fine.
    const tenants = [...shareOf((d) => d.tenantId).values()].sort((a, b) => b - a);
    expect(tenants[0]! / CORPUS.length).toBeCloseTo(0.45, 2);
    expect(tenants[0]!).toBeGreaterThan(tenants[1]! * 3);
  });

  it('concentrates writes on the most recent day', () => {
    const days = shareOf((d) => d.day);
    const latest = [...days.keys()].sort().at(-1)!;
    expect(days.get(latest)! / CORPUS.length).toBeCloseTo(0.6, 2);
  });

  it('exposes every key it advertises', () => {
    for (const key of KEYS) {
      expect(() => keyOf(key.name, CORPUS[0]!)).not.toThrow();
    }
    expect(() => keyOf('nope' as KeyName, CORPUS[0]!)).toThrow(/unknown partition key/);
  });
});

describe('distribution', () => {
  it('places every document exactly once', () => {
    for (const key of KEYS) {
      const dist = distribute(key.name);
      const total = dist.partitions.reduce((sum, p) => sum + p.docs, 0);
      expect(total).toBe(CORPUS.length);
    }
  });

  it('keeps documents sharing a key value together', () => {
    // The defining property of partitioning, and the reason a skewed key cannot
    // be fixed by adding partitions.
    const dist = distribute('tenantId');
    const homes = new Map<string, number>();
    for (const partition of dist.partitions) {
      for (const value of partition.keys) {
        expect(homes.has(value)).toBe(false);
        homes.set(value, partition.index);
      }
    }
    expect(homes.size).toBe(dist.cardinality);
  });

  it('cannot use more partitions than the key has distinct values', () => {
    const dist = distribute('day');
    expect(dist.cardinality).toBe(5);
    expect(dist.used).toBeLessThanOrEqual(5);
    // Provisioning 12 partitions buys nothing when the key has 5 values.
    expect(dist.used).toBeLessThan(dist.partitions.length);
  });

  it('leaves partitions completely idle for low-cardinality keys', () => {
    for (const key of ['tenantId', 'country', 'day'] as KeyName[]) {
      const dist = distribute(key);
      expect(dist.partitions.some((p) => p.docs === 0)).toBe(true);
    }
  });

  it('fills every partition for high-cardinality keys', () => {
    for (const key of ['userId', 'id'] as KeyName[]) {
      expect(distribute(key).used).toBe(12);
    }
  });
});

describe('skew', () => {
  it('is worst for the date key', () => {
    // Time-based partition keys concentrate *all* current writes on one
    // partition, which is why they are the classic mistake in write-heavy
    // workloads even though they look natural for time-series data.
    const byDay = distribute('day');
    expect(byDay.hotShare).toBeGreaterThan(0.6);
    expect(byDay.skew).toBeGreaterThan(8);
  });

  it('is near perfect for the high-cardinality keys', () => {
    for (const key of ['userId', 'id'] as KeyName[]) {
      const dist = distribute(key);
      expect(dist.skew).toBeLessThan(1.2);
    }
  });

  it('never reaches exactly 1, even with a per-document key', () => {
    // Hashing 2000 distinct values into 12 buckets does not produce 12 equal
    // buckets; it produces buckets that vary by a few percent. Claiming a
    // perfect spread would be the kind of tidy lie this site avoids.
    const dist = distribute('id');
    expect(dist.skew).toBeGreaterThan(1);
    expect(dist.skew).toBeLessThan(1.15);
  });

  it('ranks the keys the way the data dictates', () => {
    const order = (
      ['id', 'userId', 'tenantId+day', 'tenantId', 'country', 'day'] as KeyName[]
    ).map((k) => distribute(k).skew);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    }
  });

  it('is not fixed by cardinality alone', () => {
    // The finding worth the whole widget. Composing tenantId with day takes the
    // key from 10 distinct values to 50, and it does fill all twelve partitions
    // -- yet the busiest one still carries over a third of all traffic, because
    // the biggest tenant's busiest day is still one value.
    const composite = distribute('tenantId+day');
    expect(composite.cardinality).toBe(50);
    expect(composite.used).toBe(12);
    expect(composite.hotShare).toBeGreaterThan(0.3);

    // Better than the naive key, and nowhere near a well-spread one.
    expect(composite.skew).toBeLessThan(distribute('tenantId').skew);
    expect(composite.skew).toBeGreaterThan(distribute('userId').skew * 3);
  });
});

describe('throughput', () => {
  it('splits provisioned RU/s evenly regardless of where traffic goes', () => {
    const verdict = throughput(distribute('day'), 12_000);
    expect(verdict.perPartition).toBe(1000);
    // Traffic is not split evenly: 70% of it wants one partition.
    expect(verdict.hottestDemand).toBeGreaterThan(8000);
    expect(verdict.throttled).toBe(true);
  });

  it('reports how much of the spend is actually usable', () => {
    const skewed = throughput(distribute('day'), 10_000);
    const even = throughput(distribute('userId'), 10_000);

    // Paying for 10,000 RU/s and able to use roughly an eighth of it, while
    // container-level metrics show the container almost idle.
    expect(skewed.usableFraction).toBeLessThan(0.2);
    expect(even.usableFraction).toBeGreaterThan(0.8);
  });

  it('never claims more than all of the throughput is usable', () => {
    for (const key of KEYS) {
      const verdict = throughput(distribute(key.name), 10_000);
      expect(verdict.usableFraction).toBeGreaterThan(0);
      expect(verdict.usableFraction).toBeLessThanOrEqual(1);
    }
  });

  it('puts the throttling threshold far lower for a skewed key', () => {
    const skewed = throttlingThreshold(distribute('day'));
    const even = throttlingThreshold(distribute('userId'));
    expect(skewed).toBeLessThan(even / 5);
    // Both are derived from the documented per-partition ceiling, not invented.
    expect(skewed).toBeCloseTo(
      COSMOS_LIMITS.physicalPartitionRuPerSecond / distribute('day').hotShare,
      5,
    );
  });
});

describe('vendor limits', () => {
  it('carries its source and the date it was read', () => {
    // Prices and quotas rot. A number without a date is a number nobody can
    // check, and this file cannot verify Azure's documentation from here.
    expect(COSMOS_LIMITS.source).toMatch(/Microsoft Learn/);
    expect(COSMOS_LIMITS.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(COSMOS_LIMITS.logicalPartitionBytes).toBeGreaterThan(0);
    expect(COSMOS_LIMITS.physicalPartitionRuPerSecond).toBeGreaterThan(0);
  });
});

describe('query alignment', () => {
  it('routes a query only when every key component is filtered', () => {
    expect(isSinglePartitionQuery('tenantId', ['tenantId'])).toBe(true);
    // The synthetic-key disappointment: filtering on tenant alone does not
    // identify a tenantId|day partition, because the hash needs both halves.
    expect(isSinglePartitionQuery('tenantId+day', ['tenantId'])).toBe(false);
    expect(isSinglePartitionQuery('tenantId+day', ['tenantId', 'day'])).toBe(true);
  });

  it('shows the best-distributing key is not the best key', () => {
    // /id spreads almost perfectly and answers exactly one of the four sample
    // queries. Optimising distribution alone picks it, and that is the mistake.
    expect(distribute('id').skew).toBeLessThan(distribute('tenantId').skew);
    expect(routableQueries('id')).toBe(1);
    expect(routableQueries('tenantId')).toBeGreaterThan(routableQueries('id'));
  });

  it('leaves no key that is best on both axes', () => {
    // If one existed, partition-key choice would not be a design decision.
    const best = (score: (k: KeyName) => number) =>
      KEYS.map((k) => k.name).sort((a, b) => score(b) - score(a))[0];
    const bestSpread = best((k) => -distribute(k).skew);
    const bestRouting = best((k) => routableQueries(k));
    expect(bestSpread).not.toBe(bestRouting);
  });
});
