import type { CellState, VizStep, VizTrace } from '../core/types.ts';

/**
 * Hash table traces: hashing, collision, chaining, and the rehash.
 *
 * The step model gains one extra field here — `buckets` — because a hash table
 * is an array *of lists*, and flattening that into a single strip would hide the
 * exact thing the page is about. Everything else (captions, counters, code line
 * sync, the player) is the shared primitive layer unchanged.
 */

export interface BucketView {
  index: number;
  entries: CellState[];
  role?: 'default' | 'active' | 'compare' | 'swap' | 'sorted' | 'ghost' | 'empty';
}

export interface HashStep extends VizStep {
  buckets: BucketView[];
}

export interface HashTrace extends VizTrace {
  steps: HashStep[];
}

export interface Entry {
  key: string;
  value: number;
}

export interface HashState {
  capacity: number;
  entries: Entry[];
}

/** The load factor at which we grow. 0.75 is Java's; CPython uses 2/3. */
export const MAX_LOAD = 0.75;

/**
 * A deliberately weak string hash (djb2), truncated so collisions are easy to
 * demonstrate. Real hashes are stronger — that difference is the subject of the
 * "hash flooding" failure mode.
 */
export function hashOf(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

export const bucketOf = (key: string, capacity: number): number =>
  hashOf(key) % capacity;

function bucketsFrom(
  state: HashState,
  roles: Record<number, BucketView['role']> = {},
  entryRoles: Record<string, CellState['role']> = {},
): BucketView[] {
  return Array.from({ length: state.capacity }, (_, index) => ({
    index,
    role: roles[index],
    entries: state.entries
      .filter((entry) => bucketOf(entry.key, state.capacity) === index)
      .map((entry, i) => ({
        id: `e-${entry.key}`,
        value: `${entry.key}:${entry.value}`,
        index: i,
        role: entryRoles[entry.key],
      })),
  }));
}

const countersFor = (state: HashState, collisions: number) => ({
  entries: state.entries.length,
  capacity: state.capacity,
  collisions,
  // Rendered ×100 because the counter display is integer-valued.
  'load ×100': Math.round((state.entries.length / state.capacity) * 100),
});

export const INSERT_CODE = {
  python: `def insert(table, key, value):
    index = hash(key) % table.capacity
    bucket = table.buckets[index]
    for i, (k, _) in enumerate(bucket):
        if k == key:
            bucket[i] = (key, value)   # replace, don't append
            return
    bucket.append((key, value))
    table.size += 1
    if table.size / table.capacity > 0.75:
        rehash(table)`,
  typescript: `function insert(table: Table, key: string, value: number): void {
  const index = hashOf(key) % table.capacity;
  const bucket = table.buckets[index];
  for (let i = 0; i < bucket.length; i++) {
    if (bucket[i].key === key) {
      bucket[i] = { key, value };      // replace, don't append
      return;
    }
  }
  bucket.push({ key, value });
  table.size++;
  if (table.size / table.capacity > 0.75) rehash(table);
}`,
} as const;

const COUNTER_SPEC = [
  { key: 'entries', label: 'entries' },
  { key: 'capacity', label: 'buckets' },
  { key: 'collisions', label: 'collisions' },
  { key: 'load ×100', label: 'load factor ×100' },
];

/** Insert one key, showing the hash, the bucket, any collision, and any rehash. */
export function traceInsert(state: HashState, key: string, value: number): HashTrace {
  const steps: HashStep[] = [];
  let collisions = 0;
  const working: HashState = { ...state, entries: [...state.entries] };

  const hash = hashOf(key);
  const index = hash % working.capacity;
  const occupant = working.entries.filter(
    (entry) => bucketOf(entry.key, working.capacity) === index,
  );
  const existing = occupant.find((entry) => entry.key === key);

  steps.push({
    caption: `hash("${key}") = ${hash}. That number is far bigger than the table, so it gets folded into range: ${hash} mod ${working.capacity} = bucket ${index}.`,
    codeLine: 2,
    counters: countersFor(working, collisions),
    buckets: bucketsFrom(working, { [index]: 'active' }),
    phase: 'hash',
  });

  if (existing) {
    steps.push({
      caption: `Bucket ${index} already holds the key "${key}". This is not a collision — it is the same key, so the value is replaced and the table does not grow.`,
      codeLine: [4, 7],
      counters: countersFor(working, collisions),
      buckets: bucketsFrom(working, { [index]: 'compare' }, { [key]: 'swap' }),
    });

    working.entries = working.entries.map((entry) =>
      entry.key === key ? { key, value } : entry,
    );

    steps.push({
      caption: `Updated in place. Distinguishing "same key" from "different key, same bucket" is the whole job of the comparison inside the bucket.`,
      codeLine: 6,
      counters: countersFor(working, collisions),
      buckets: bucketsFrom(working, {}, { [key]: 'sorted' }),
      phase: 'done',
    });

    return { steps, code: INSERT_CODE, counterSpec: COUNTER_SPEC };
  }

  if (occupant.length > 0) {
    collisions++;
    steps.push({
      caption: `Collision. Bucket ${index} already holds ${occupant.map((e) => `"${e.key}"`).join(', ')} — different keys that happen to hash into the same slot. Chaining keeps both by storing a list in the bucket.`,
      codeLine: [3, 5],
      counters: countersFor(working, collisions),
      buckets: bucketsFrom(
        working,
        { [index]: 'compare' },
        Object.fromEntries(occupant.map((e) => [e.key, 'compare' as const])),
      ),
      phase: 'collision',
    });
  }

  working.entries = [...working.entries, { key, value }];

  steps.push({
    caption:
      occupant.length > 0
        ? `Appended to the chain in bucket ${index}. Lookups for this key now cost one hash plus a walk of ${occupant.length + 1} entries — still O(1) on average, but no longer a single step.`
        : `Bucket ${index} was empty, so this is the good case: one hash, one array index, done.`,
    codeLine: 8,
    counters: countersFor(working, collisions),
    buckets: bucketsFrom(working, {}, { [key]: 'active' }),
  });

  const load = working.entries.length / working.capacity;

  if (load > MAX_LOAD) {
    const oldCapacity = working.capacity;
    steps.push({
      caption: `Load factor is now ${load.toFixed(2)}, above the ${MAX_LOAD} threshold. Chains are getting long, so the table must grow — and because the bucket index depends on the capacity, every existing key has to be rehashed.`,
      codeLine: [10, 11],
      counters: countersFor(working, collisions),
      buckets: bucketsFrom(
        working,
        {},
        Object.fromEntries(working.entries.map((e) => [e.key, 'compare' as const])),
      ),
      phase: 'rehash',
    });

    working.capacity = oldCapacity * 2;

    steps.push({
      caption: `Rehashed into ${working.capacity} buckets. This one insert cost O(n) — every key recomputed and re-placed. Note the keys landed in completely different buckets: nothing about their old position carried over.`,
      counters: countersFor(working, collisions),
      buckets: bucketsFrom(
        working,
        {},
        Object.fromEntries(working.entries.map((e) => [e.key, 'swap' as const])),
      ),
      phase: 'done',
    });
  }

  return { steps, code: INSERT_CODE, counterSpec: COUNTER_SPEC };
}

/** Look a key up, walking the chain so the average-case cost is visible. */
export function traceLookup(state: HashState, key: string): HashTrace {
  const steps: HashStep[] = [];
  const hash = hashOf(key);
  const index = hash % state.capacity;
  const chain = state.entries.filter(
    (entry) => bucketOf(entry.key, state.capacity) === index,
  );

  steps.push({
    caption: `hash("${key}") mod ${state.capacity} = bucket ${index}. One hash computation, then one array index — this part does not depend on how many keys the table holds.`,
    codeLine: 2,
    counters: countersFor(state, 0),
    buckets: bucketsFrom(state, { [index]: 'active' }),
    phase: 'hash',
  });

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;
    const hit = entry.key === key;

    steps.push({
      caption: hit
        ? `Found "${key}" after ${i + 1} comparison${i === 0 ? '' : 's'}.`
        : `"${entry.key}" is not "${key}" — same bucket, different key. Keep walking the chain.`,
      codeLine: [4, 5],
      counters: countersFor(state, 0),
      buckets: bucketsFrom(
        state,
        { [index]: 'active' },
        { [entry.key]: hit ? 'sorted' : 'compare' },
      ),
      ...(hit ? { phase: 'done' } : {}),
    });

    if (hit) return { steps, code: INSERT_CODE, counterSpec: COUNTER_SPEC };
  }

  steps.push({
    caption: `Bucket ${index} does not contain "${key}", so it is not in the table. A miss costs the same as walking the full chain — which is why long chains hurt lookups that fail, too.`,
    counters: countersFor(state, 0),
    buckets: bucketsFrom(state, { [index]: 'ghost' }),
    phase: 'done',
  });

  return { steps, code: INSERT_CODE, counterSpec: COUNTER_SPEC };
}

/** A resting view of the table. */
export function traceIdle(state: HashState): HashTrace {
  return {
    steps: [
      {
        caption: `${state.entries.length} keys in ${state.capacity} buckets — load factor ${(state.entries.length / state.capacity).toFixed(2)}. Add a key to watch it hash, or add one that collides.`,
        counters: countersFor(state, 0),
        buckets: bucketsFrom(state),
      },
    ],
    code: INSERT_CODE,
    counterSpec: COUNTER_SPEC,
  };
}

/** Final table state after a trace, for chaining operations together. */
export function finalState(trace: HashTrace, previous: HashState): HashState {
  const last = trace.steps.at(-1)!;
  const entries: Entry[] = last.buckets.flatMap((bucket) =>
    bucket.entries.map((cell) => {
      const [key, value] = String(cell.value).split(':');
      return { key: key!, value: Number(value) };
    }),
  );
  return { capacity: last.buckets.length || previous.capacity, entries };
}

/** Find a key that lands in the same bucket as an existing one. */
export function findCollidingKey(state: HashState): string | null {
  if (state.entries.length === 0) return null;
  const target = bucketOf(state.entries[0]!.key, state.capacity);

  for (let i = 0; i < 5000; i++) {
    const candidate = `k${i}`;
    if (
      bucketOf(candidate, state.capacity) === target &&
      !state.entries.some((entry) => entry.key === candidate)
    ) {
      return candidate;
    }
  }
  return null;
}
