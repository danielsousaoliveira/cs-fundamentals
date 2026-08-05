/**
 * Partition keys, and why the wrong one is invisible until it is catastrophic.
 *
 * Every horizontally-scaled store — CosmosDB, DynamoDB, Kafka, Citus, a sharded
 * MySQL — makes you choose a field to hash. The choice looks like a schema
 * detail and is really a capacity decision, because throughput is provisioned
 * for the *collection* and consumed by the *partition*. Pick a key that
 * concentrates traffic and you can be throttled at 5% of the capacity you are
 * paying for, with every dashboard showing plenty of headroom.
 *
 * The trap is that a bad key is fine in development. With a hundred documents
 * across ten tenants, every key looks balanced. The skew only appears once the
 * data has real shape — one tenant twenty times bigger than the median, all
 * writes landing on today's date — and by then the key is baked in. In CosmosDB
 * the partition key is immutable: changing it means migrating the container.
 *
 * So this module does the arithmetic on a corpus with realistic shape, using a
 * real hash function. Nothing here is a story about skew; the distributions come
 * out of hashing the documents below, and if you change the corpus the
 * conclusions move with it.
 */

/**
 * FNV-1a, 32-bit.
 *
 * A real, specified hash — not `Math.random()` and not a toy sum. It matters
 * that this is a genuine avalanche hash: the whole claim that a *high
 * cardinality* key spreads evenly rests on the hash mixing, and a weak hash
 * would leave visible structure that made a good key look bad. FNV-1a is not
 * what CosmosDB uses internally (it uses its own range-hash scheme), but the
 * property being demonstrated — uniform spread of distinct values, no spread at
 * all for repeated values — is a property of hashing itself, not of the vendor.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, 16777619, via shifts to stay in 32-bit integer range.
    hash =
      (hash +
        ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}

export interface Doc {
  id: string;
  tenantId: string;
  userId: string;
  country: string;
  /** ISO date. Every write lands on "today" in a real system — that is the point. */
  day: string;
  /** Bytes. Used for the per-partition storage limit, which is a hard ceiling. */
  bytes: number;
}

const TENANTS = [
  // Deliberately Zipf-ish: one whale, a few mid-size, a long tail. This is what
  // every B2B dataset looks like, and it is why "tenantId" is the most commonly
  // chosen and most commonly regretted partition key.
  { id: 'acme', weight: 45 },
  { id: 'globex', weight: 14 },
  { id: 'initech', weight: 11 },
  { id: 'umbrella', weight: 8 },
  { id: 'hooli', weight: 6 },
  { id: 'stark', weight: 5 },
  { id: 'wayne', weight: 4 },
  { id: 'tyrell', weight: 3 },
  { id: 'soylent', weight: 2 },
  { id: 'vehement', weight: 2 },
];

const COUNTRIES = ['PT', 'ES', 'FR', 'DE', 'GB', 'US'];
const DAYS = ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];

/**
 * Build the corpus deterministically.
 *
 * Deterministic on purpose: a widget whose numbers change on every render
 * teaches nothing, and a test cannot pin a distribution that moves. The
 * generator is a counter, not a random source.
 */
export function buildCorpus(count = 2000): Doc[] {
  const docs: Doc[] = [];
  const total = TENANTS.reduce((sum, t) => sum + t.weight, 0);

  for (let i = 0; i < count; i++) {
    // Walk the weighted tenant list by position rather than by sampling, so the
    // realised share matches the intended weight exactly.
    let cursor = (i * total) / count;
    let tenant = TENANTS[0]!;
    for (const candidate of TENANTS) {
      if (cursor < candidate.weight) {
        tenant = candidate;
        break;
      }
      cursor -= candidate.weight;
    }

    // Writes concentrate on the most recent day: 60% today, the rest spread
    // over the previous four. Time-based keys fail for this reason and no other.
    const dayIndex = i % 10 < 6 ? DAYS.length - 1 : i % (DAYS.length - 1);

    docs.push({
      id: `doc-${i}`,
      tenantId: tenant.id,
      userId: `user-${i % 400}`,
      country: COUNTRIES[i % COUNTRIES.length]!,
      day: DAYS[dayIndex]!,
      bytes: 1200 + ((i * 7919) % 3000),
    });
  }

  return docs;
}

export const CORPUS = buildCorpus();

export type KeyName = 'tenantId' | 'country' | 'day' | 'userId' | 'tenantId+day' | 'id';

export const KEYS: { name: KeyName; label: string; of: (doc: Doc) => string }[] = [
  { name: 'tenantId', label: '/tenantId', of: (d) => d.tenantId },
  { name: 'country', label: '/country', of: (d) => d.country },
  { name: 'day', label: '/day', of: (d) => d.day },
  { name: 'tenantId+day', label: '/tenantId_day', of: (d) => `${d.tenantId}|${d.day}` },
  { name: 'userId', label: '/userId', of: (d) => d.userId },
  { name: 'id', label: '/id', of: (d) => d.id },
];

export function keyOf(name: KeyName, doc: Doc): string {
  const key = KEYS.find((k) => k.name === name);
  if (!key) throw new Error(`unknown partition key '${name}'`);
  return key.of(doc);
}

export interface Partition {
  index: number;
  docs: number;
  bytes: number;
  /** Distinct logical partition keys that hashed here. */
  keys: string[];
}

export interface Distribution {
  key: KeyName;
  partitions: Partition[];
  /** Distinct values of the partition key — the ceiling on how many partitions can be used. */
  cardinality: number;
  /** Partitions holding at least one document. */
  used: number;
  /** Documents in the busiest partition, as a share of all documents. */
  hotShare: number;
  /**
   * Busiest partition divided by the average. 1.0 is perfect; the number that
   * matters, because provisioned throughput is divided evenly and consumed
   * unevenly.
   */
  skew: number;
  hottest: Partition;
}

/**
 * Distribute the corpus over `physical` partitions by hashing the chosen key.
 *
 * The modulo is the honest part of the model. Real systems use consistent
 * hashing or range partitioning so that adding a partition does not reshuffle
 * everything — but the property being taught (documents sharing a key value
 * always land together, so a skewed key produces a skewed load) is identical
 * under any of those schemes.
 */
export function distribute(
  key: KeyName,
  physical = 12,
  docs: Doc[] = CORPUS,
): Distribution {
  const partitions: Partition[] = Array.from({ length: physical }, (_, index) => ({
    index,
    docs: 0,
    bytes: 0,
    keys: [],
  }));

  const seen = new Set<string>();
  const keysPerPartition: Set<string>[] = partitions.map(() => new Set());

  for (const doc of docs) {
    const value = keyOf(key, doc);
    seen.add(value);
    const target = partitions[fnv1a(value) % physical]!;
    target.docs++;
    target.bytes += doc.bytes;
    keysPerPartition[target.index]!.add(value);
  }

  for (const partition of partitions) {
    partition.keys = [...keysPerPartition[partition.index]!].sort();
  }

  const hottest = partitions.reduce((a, b) => (b.docs > a.docs ? b : a));
  const mean = docs.length / physical;

  return {
    key,
    partitions,
    cardinality: seen.size,
    used: partitions.filter((p) => p.docs > 0).length,
    hotShare: hottest.docs / docs.length,
    skew: mean === 0 ? 1 : hottest.docs / mean,
    hottest,
  };
}

/**
 * Vendor limits, quoted from the documentation rather than from memory.
 *
 * These are the ceilings that turn a skewed key from a performance annoyance
 * into an outage. They are also exactly the kind of number that rots, so each
 * one carries its source and the date the page was read — nothing in this
 * repository can re-verify them, and a quota without a date is a quota nobody
 * can check.
 *
 * The subtlety worth keeping: because a logical partition maps to exactly one
 * physical partition, the 10,000 RU/s physical ceiling is also a *logical*
 * ceiling. One hot key cannot be rescued by provisioning more throughput. That
 * is the difference between "slow" and "cannot be made faster at any price".
 */
export const COSMOS_LIMITS = {
  /** Hard cap on one logical partition's storage. Exceed it and writes fail. */
  logicalPartitionBytes: 20 * 1024 * 1024 * 1024,
  /** Ceiling on RU/s one physical — and therefore one logical — partition serves. */
  physicalPartitionRuPerSecond: 10_000,
  /** A physical partition stores up to this much across all its logical partitions. */
  physicalPartitionBytes: 50 * 1024 * 1024 * 1024,
  source: 'Microsoft Learn, "Partitioning and horizontal scaling in Azure Cosmos DB"',
  url: 'https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview',
  /** Date the page above was last updated, as reported by Microsoft Learn. */
  documentUpdated: '2026-06-15',
  readOn: '2026-08-05',
} as const;

export interface ThroughputVerdict {
  /** RU/s provisioned across the whole container. */
  provisioned: number;
  /** Even share each physical partition receives. */
  perPartition: number;
  /** RU/s the hottest partition actually needs, given its share of traffic. */
  hottestDemand: number;
  throttled: boolean;
  /** Fraction of provisioned throughput usable before the hot partition throttles. */
  usableFraction: number;
}

/**
 * The arithmetic that surprises people.
 *
 * Provisioned RU/s is split *evenly* across physical partitions. Traffic is not.
 * So the first partition to hit its share starts returning 429s while the
 * container as a whole reports low utilisation — you are throttled at a fraction
 * of what you are paying for, and the metric that would explain it is per
 * partition, not per container.
 */
export function throughput(dist: Distribution, provisioned: number): ThroughputVerdict {
  const perPartition = provisioned / dist.partitions.length;
  const hottestDemand = provisioned * dist.hotShare;
  return {
    provisioned,
    perPartition,
    hottestDemand,
    throttled: hottestDemand > perPartition,
    // With a perfectly even key this is 1. With everything on one partition and
    // 12 partitions provisioned, it is 1/12 -- you can use 8% of your spend.
    usableFraction: Math.min(1, perPartition / hottestDemand),
  };
}

/** Provisioned RU/s at which the hottest partition begins to throttle. */
export function throttlingThreshold(dist: Distribution): number {
  return COSMOS_LIMITS.physicalPartitionRuPerSecond / dist.hotShare;
}

/**
 * The queries an application actually runs.
 *
 * Distribution is only half the decision, and optimising for it alone produces
 * the second-most-common partitioning mistake: `/id` spreads perfectly and is a
 * poor key for most workloads, because a query filtering on anything else has
 * to visit every physical partition. Microsoft's own guidance names this as an
 * anti-pattern — "a high-cardinality key isn't enough by itself".
 *
 * So the widget scores both axes. A key is good when it spreads load *and*
 * appears in the predicates you actually send.
 */
export const QUERIES: { label: string; filters: KeyName[] }[] = [
  { label: 'all orders for one tenant', filters: ['tenantId'] },
  { label: "one tenant's orders on a day", filters: ['tenantId', 'day'] },
  { label: 'one user’s orders', filters: ['userId'] },
  { label: 'fetch one document by id', filters: ['id'] },
];

/**
 * Can this query be routed to a single partition, or must it fan out?
 *
 * A composite key is only satisfied when *every* component is filtered: a
 * `tenantId|day` key does not help a query that filters on tenant alone,
 * because the hash needs both halves to identify the partition. This is the
 * detail that makes synthetic keys disappointing in practice, and it is exactly
 * what the docs warn about.
 */
export function isSinglePartitionQuery(key: KeyName, filters: KeyName[]): boolean {
  const components = key.split('+') as KeyName[];
  return components.every((component) => filters.includes(component));
}

/** How many of the sample queries this key can answer without fanning out. */
export function routableQueries(key: KeyName): number {
  return QUERIES.filter((query) => isSinglePartitionQuery(key, query.filters)).length;
}
