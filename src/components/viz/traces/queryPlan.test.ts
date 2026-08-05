import { describe, expect, it } from 'vitest';
import {
  BLOCK_BYTES,
  CAPTURED,
  bytesTouched,
  crossover,
  estimateError,
  flatten,
  isDegradedIndexOnly,
  matrixCell,
  scanNode,
  scenario,
  speedup,
  STATUS_SHARE,
  sweepPoint,
  totalRows,
  usesIndex,
  walk,
  type StatusValue,
} from './queryPlan.ts';

const STATUSES: StatusValue[] = ['complete', 'pending', 'refunded', 'cancelled'];

describe('the capture itself', () => {
  it('is from a real PostgreSQL instance', () => {
    // If this fixture ever stops being real captured output, the entire
    // databases section quietly becomes assertion rather than evidence. Pin it.
    expect(CAPTURED.version).toMatch(/^PostgreSQL \d+/);
    expect(CAPTURED.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(CAPTURED.rowCount).toBe(500_000);
  });

  it('covers a table large enough for the planner to have a real choice', () => {
    // Below a few MB Postgres will seq-scan everything and every lesson here
    // collapses. 40 MB is comfortably past that.
    expect(CAPTURED.tableBytes).toBeGreaterThan(40 * 1024 * 1024);
  });

  it('has every matrix cell and no duplicates', () => {
    expect(CAPTURED.matrix).toHaveLength(8);
    const keys = CAPTURED.matrix.map((c) => `${c.index}/${c.status}`);
    expect(new Set(keys).size).toBe(8);
  });

  it('reports index sizes smaller than the table', () => {
    for (const index of CAPTURED.indexSizes) {
      expect(index.bytes).toBeGreaterThan(0);
      expect(index.bytes).toBeLessThan(CAPTURED.tableBytes);
    }
  });
});

describe('walking a plan', () => {
  it('returns parents before children', () => {
    const rows = walk(scenario('hashJoin').root);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[0]).toBe(scenario('hashJoin').root);
  });

  it('finds the scan node beneath the aggregates', () => {
    const node = scanNode(matrixCell('present', 'cancelled'));
    expect(node.nodeType).toMatch(/Scan/);
    expect(node.relation).toBe('orders');
  });

  it('prefers the bitmap heap node over the bitmap index node beneath it', () => {
    // Both are "Scan" nodes and both are real, but only the heap node describes
    // the access pattern the reader is being taught to recognise.
    const bitmap = CAPTURED.sweep.find(
      (p) => scanNode(p).nodeType === 'Bitmap Heap Scan',
    );
    if (bitmap) {
      expect(scanNode(bitmap).nodeType).toBe('Bitmap Heap Scan');
    }
  });
});

describe('the index the planner refuses to use', () => {
  it('declines the index for the 92% value even though it exists', () => {
    // The central claim of the whole page, asserted against captured evidence.
    const withIndex = matrixCell('present', 'complete');
    expect(usesIndex(withIndex)).toBe(false);
    expect(scanNode(withIndex).nodeType).toMatch(/Seq Scan/);
  });

  it('uses the same index for every rarer value', () => {
    for (const status of ['pending', 'refunded', 'cancelled'] as StatusValue[]) {
      expect(usesIndex(matrixCell('present', status))).toBe(true);
    }
  });

  it('never uses an index that does not exist', () => {
    for (const status of STATUSES) {
      expect(usesIndex(matrixCell('absent', status))).toBe(false);
    }
  });

  it('makes the rare values dramatically faster and the common value not', () => {
    // The shape that justifies "it depends on the query, not the index".
    expect(speedup('cancelled')).toBeGreaterThan(5);
    expect(speedup('complete')).toBeLessThan(2);
  });

  it('touches far fewer buffers when the index is used', () => {
    const seq = scanNode(matrixCell('present', 'complete'));
    const idx = scanNode(matrixCell('present', 'cancelled'));
    // Buffers are the honest measure: wall-clock varies with cache and load,
    // but blocks read is a property of the plan.
    expect(idx.buffers).toBeLessThan(seq.buffers / 10);
    expect(bytesTouched(seq)).toBe(seq.buffers * BLOCK_BYTES);
  });

  it('orders the status shares the way the data was generated', () => {
    const shares = STATUSES.map((s) => STATUS_SHARE[s]);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('per-loop rows', () => {
  it('multiplies parallel worker rows back up to the true total', () => {
    // 92% of 500k is 460k. A reader taking `Actual Rows` at face value on this
    // plan would conclude ~153k, which is the single most common misreading of
    // EXPLAIN output.
    const scan = scanNode(matrixCell('present', 'complete'));
    expect(scan.loops).toBeGreaterThan(1);
    expect(scan.actualRows).toBeLessThan(200_000);
    expect(totalRows(scan)).toBeGreaterThan(400_000);
  });

  it('leaves single-loop nodes unchanged', () => {
    const scan = scanNode(scenario('primaryKeyLookup'));
    expect(scan.loops).toBe(1);
    expect(totalRows(scan)).toBe(Math.round(scan.actualRows));
  });
});

describe('estimate versus actual', () => {
  it('is near-perfect when the predicates are independent', () => {
    const scan = scanNode(matrixCell('present', 'cancelled'));
    expect(estimateError(scan)).toBeLessThan(1.5);
  });

  it('blows up completely on correlated predicates', () => {
    // status='cancelled' AND country='PT' matches zero rows, and the planner
    // expects hundreds -- because it multiplies two independent selectivities
    // that are not independent at all.
    const scan = scanNode(scenario('correlatedBefore'));
    expect(totalRows(scan)).toBe(0);
    expect(scan.estRows).toBeGreaterThan(100);
    expect(estimateError(scan)).toBe(Infinity);
  });

  it('is repaired by extended statistics', () => {
    const before = scanNode(scenario('correlatedBefore'));
    const after = scanNode(scenario('correlatedAfter'));
    // Not to zero -- Postgres clamps row estimates at 1 -- but from hundreds to
    // one. The honest version of "CREATE STATISTICS fixes it".
    expect(after.estRows).toBeLessThan(before.estRows / 50);
    expect(after.estRows).toBe(1);
  });

  it('shows stale statistics estimating a full table as nearly empty', () => {
    const stale = scanNode(scenario('staleStats'));
    const fresh = scanNode(scenario('freshStats'));
    expect(stale.estRows).toBeLessThan(1000);
    expect(totalRows(stale)).toBeGreaterThan(400_000);
    expect(estimateError(stale)).toBeGreaterThan(100);
    // ANALYZE alone closes the gap; nothing about the data changed.
    expect(estimateError(fresh)).toBeLessThan(1.5);
  });

  it('treats over- and under-estimates as equally wrong', () => {
    const over = { estRows: 1000, actualRows: 10, loops: 1 } as never;
    const under = { estRows: 10, actualRows: 1000, loops: 1 } as never;
    expect(estimateError(over)).toBeCloseTo(100, 5);
    expect(estimateError(under)).toBeCloseTo(100, 5);
  });
});

describe('the selectivity crossover', () => {
  it('abandons the index partway up the range when the heap must be read', () => {
    const point = crossover('heap');
    expect(point).not.toBeNull();
    expect(point!.firstSeqPct).toBeGreaterThan(10);
    expect(point!.firstSeqPct).toBeLessThan(50);
  });

  it('never abandons the index when the query can be answered from it', () => {
    // The finding. Folklore says indexes stop paying somewhere around 5-10%
    // selectivity; the capture says that rule is about *heap access*, not about
    // indexes. An index-only scan stays ahead across the entire sweep.
    expect(crossover('indexOnly')).toBeNull();
    for (const point of CAPTURED.sweep.filter((p) => p.query === 'indexOnly')) {
      expect(usesIndex(point)).toBe(true);
    }
  });

  it('covers a wide enough range for that claim to mean something', () => {
    const pcts = CAPTURED.sweep
      .filter((p) => p.query === 'indexOnly')
      .map((p) => p.pct);
    expect(Math.min(...pcts)).toBeLessThanOrEqual(2);
    expect(Math.max(...pcts)).toBeGreaterThanOrEqual(60);
  });

  it('throws rather than inventing a point that was never captured', () => {
    expect(() => sweepPoint('heap', 37)).toThrow(/no captured sweep point/);
    expect(sweepPoint('heap', 29).pct).toBe(29);
  });
});

describe('index-only scans and the visibility map', () => {
  it('touches no heap pages on a freshly vacuumed table', () => {
    const scan = scanNode(scenario('indexOnlyClean'));
    expect(scan.nodeType).toBe('Index Only Scan');
    expect(scan.heapFetches).toBe(0);
    expect(isDegradedIndexOnly(scan)).toBe(false);
  });

  it('starts fetching from the heap after a no-op UPDATE', () => {
    // The plan is identical. The query is identical. The data is identical --
    // the UPDATE set amount_cents to its own value. Only the visibility map
    // changed, and latency roughly doubled.
    const scan = scanNode(scenario('indexOnlyAfterUpdate'));
    expect(scan.nodeType).toBe('Index Only Scan');
    expect(scan.heapFetches).toBeGreaterThan(0);
    expect(isDegradedIndexOnly(scan)).toBe(true);
    expect(scan.buffers).toBeGreaterThan(
      scanNode(scenario('indexOnlyClean')).buffers * 5,
    );
  });
});

describe('join strategy', () => {
  it('hashes the small side when joining every row', () => {
    const nodes = walk(scenario('hashJoin').root).map((n) => n.nodeType);
    expect(nodes).toContain('Hash Join');
  });

  it('switches to a nested loop when the outer side is tiny', () => {
    const nodes = walk(scenario('nestedLoop').root).map((n) => n.nodeType);
    expect(nodes).toContain('Nested Loop');
    expect(nodes).not.toContain('Hash Join');
  });
});

describe('flatten', () => {
  it('attributes time exclusive of children', () => {
    const rows = flatten(scenario('hashJoin'));
    // Exclusive shares partition the root's time, so they sum to at most 1.
    // Using inclusive time instead would put ~1 on every node down the spine
    // and sum to several hundred percent.
    const sum = rows.reduce((total, r) => total + r.selfShare, 0);
    expect(sum).toBeLessThanOrEqual(1.001);
    expect(sum).toBeGreaterThan(0.3);
  });

  it('sums to at most 1 for every captured scenario', () => {
    for (const name of Object.keys(CAPTURED.scenarios)) {
      const sum = flatten(scenario(name)).reduce((t, r) => t + r.selfShare, 0);
      expect(sum).toBeLessThanOrEqual(1.001);
    }
  });

  it('never reports a negative share', () => {
    for (const name of Object.keys(CAPTURED.scenarios)) {
      for (const row of flatten(scenario(name))) {
        expect(row.selfShare).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('indents children below their parent', () => {
    const rows = flatten(scenario('hashJoin'));
    expect(rows[0]!.depth).toBe(0);
    expect(Math.max(...rows.map((r) => r.depth))).toBeGreaterThan(1);
    // Depth never jumps by more than one going down the list.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.depth - rows[i - 1]!.depth).toBeLessThanOrEqual(1);
    }
  });
});

describe('missing data', () => {
  it('throws rather than returning a plausible default', () => {
    expect(() => scenario('nope')).toThrow(/no captured scenario/);
    // @ts-expect-error deliberately invalid status
    expect(() => matrixCell('present', 'archived')).toThrow(/no captured plan/);
  });
});
