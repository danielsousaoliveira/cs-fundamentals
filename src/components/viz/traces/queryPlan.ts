/**
 * Reading a query plan, over plans that were actually captured.
 *
 * This module deliberately computes nothing about databases. Every fact it
 * returns is read out of `fixtures/queryPlans.ts`, which came from
 * `EXPLAIN (ANALYZE, BUFFERS)` on a real PostgreSQL 18 instance holding 500,000
 * rows. The functions here are analysis over captured evidence, not a simulation
 * of a planner.
 *
 * That distinction is the whole reason the section can make quantitative claims.
 * A hand-written "cost model" would have let us assert whatever the prose needed
 * — and the one claim this section rests on is genuinely counter-intuitive: an
 * index can exist, be perfectly applicable, and still be correctly ignored.
 *
 * What the analysis is for: a plan is a tree, and the interesting facts are
 * mostly about relationships between nodes rather than any single node. Where
 * the time actually went. Where the estimate diverged from reality. Whether the
 * scan touched the heap. Those need a walk, and a walk is worth testing.
 */

import {
  CAPTURED,
  type CapturedNode,
  type CapturedPlan,
} from './fixtures/queryPlans.ts';

export { CAPTURED };
export type { CapturedNode, CapturedPlan };

/** Postgres reads and writes the heap in 8 KB pages; `buffers` counts those. */
export const BLOCK_BYTES = 8192;

/** Depth-first walk, parents before children — the order EXPLAIN prints them. */
export function walk(node: CapturedNode): CapturedNode[] {
  return [node, ...(node.children ?? []).flatMap(walk)];
}

/**
 * The scan node at the bottom of the plan — what actually read the table.
 *
 * Everything above it (aggregates, gathers, sorts) is bookkeeping over rows the
 * scan already produced, so when a reader asks "did it use the index?", this is
 * the node they mean.
 */
export function scanNode(plan: CapturedPlan): CapturedNode {
  const scans = walk(plan.root).filter((n) => /Scan/.test(n.nodeType));
  // Bitmap plans nest `Bitmap Index Scan` under `Bitmap Heap Scan`. The heap
  // node is the one that describes the access pattern, and it comes first in
  // the walk, so taking the first match is correct rather than incidental.
  return scans[0] ?? plan.root;
}

/**
 * Did this plan reach the rows through an index?
 *
 * Matching on the string "Index" is the obvious implementation and it is wrong,
 * because the node that means "I used an index and then went to the heap in
 * physical order" is called **Bitmap Heap Scan** — no "Index" in the name, and
 * its `Bitmap Index Scan` child is the one carrying the word. Testing the top
 * scan node alone therefore reports every bitmap plan as a sequential one, which
 * is precisely the plan shape a selectivity sweep spends most of its time in.
 */
export function usesIndex(plan: CapturedPlan): boolean {
  return walk(plan.root).some((n) => /Index/.test(n.nodeType));
}

/**
 * True total rows a node produced.
 *
 * `Actual Rows` in EXPLAIN is a **per-loop average**, which is the single most
 * misread number in the whole output. In a parallel plan `loops` is the number
 * of workers, so a node reporting 153,333 rows over 3 loops really produced
 * 460,000. Readers who skip this consistently conclude their query returns a
 * third of the rows it does.
 */
export function totalRows(node: CapturedNode): number {
  return Math.round(node.actualRows * node.loops);
}

/**
 * How badly the planner mis-estimated this node, as a ratio ≥ 1.
 *
 * Symmetric on purpose: a 100× under-estimate and a 100× over-estimate are both
 * "100× wrong", and both pick bad plans. Returns `Infinity` when the planner
 * expected rows and got none, which is not a pathological case to guard away —
 * it is the correlated-predicate scenario, and it is the point.
 */
export function estimateError(node: CapturedNode): number {
  // Both sides per-loop. `Plan Rows` is per-worker in a parallel plan for the
  // same reason `Actual Rows` is, so scaling only the actual side reports a
  // three-worker plan as 3x mis-estimated when the planner was in fact right.
  const actual = node.actualRows;
  if (actual === 0 && node.estRows === 0) return 1;
  if (actual === 0) return Infinity;
  const ratio = node.estRows / actual;
  return ratio >= 1 ? ratio : 1 / ratio;
}

/** Bytes of table data the node moved through — buffers made legible. */
export function bytesTouched(node: CapturedNode): number {
  return node.buffers * BLOCK_BYTES;
}

/**
 * An Index Only Scan that had to visit the heap anyway.
 *
 * The name promises the heap is never touched, but that is only true where the
 * visibility map marks a page all-visible, and only VACUUM sets that bit. After
 * writes, `heapFetches` climbs and the "index-only" scan quietly becomes a
 * normal index scan with extra steps. It is a latency regression with no query
 * change, no schema change, and no plan change — which is what makes it hard.
 */
export function isDegradedIndexOnly(node: CapturedNode): boolean {
  return node.nodeType === 'Index Only Scan' && (node.heapFetches ?? 0) > 0;
}

export type StatusValue = 'complete' | 'pending' | 'refunded' | 'cancelled';
export type IndexState = 'absent' | 'present';

/** Share of the table each status value covers — the selectivity the planner weighs. */
export const STATUS_SHARE: Record<StatusValue, number> = {
  complete: 0.92,
  pending: 0.05,
  refunded: 0.02,
  cancelled: 0.01,
};

export function matrixCell(index: IndexState, status: StatusValue) {
  const cell = CAPTURED.matrix.find((c) => c.index === index && c.status === status);
  if (!cell) throw new Error(`no captured plan for ${index}/${status}`);
  return cell;
}

/**
 * The comparison the widget is built to make: same query, same index, and the
 * planner reaching opposite conclusions because the *value* changed.
 */
export function speedup(status: StatusValue): number {
  return (
    matrixCell('absent', status).executionMs / matrixCell('present', status).executionMs
  );
}

export interface Crossover {
  /** Last selectivity where the index still won. */
  lastIndexedPct: number;
  /** First selectivity where the planner switched to a sequential scan. */
  firstSeqPct: number;
}

/**
 * Where the planner abandons the index, measured rather than asserted.
 *
 * Returns `null` when it never does — which is the actual result for the
 * index-only curve, and is the finding rather than a missing answer. "Indexes
 * stop paying above ~10% selectivity" is the folklore; the capture says it
 * depends entirely on whether the query can avoid the heap.
 */
export function crossover(query: 'indexOnly' | 'heap'): Crossover | null {
  const points = CAPTURED.sweep
    .filter((p) => p.query === query)
    .sort((a, b) => a.pct - b.pct);

  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1]!;
    const after = points[i]!;
    if (usesIndex(before) && !usesIndex(after)) {
      return { lastIndexedPct: before.pct, firstSeqPct: after.pct };
    }
  }
  return null;
}

export function sweepPoint(query: 'indexOnly' | 'heap', pct: number) {
  const point = CAPTURED.sweep.find((p) => p.query === query && p.pct === pct);
  if (!point) throw new Error(`no captured sweep point for ${query} at ${pct}%`);
  return point;
}

export function scenario(name: string): CapturedPlan {
  const plan = CAPTURED.scenarios[name];
  if (!plan) throw new Error(`no captured scenario '${name}'`);
  return plan;
}

/** One row of the plan tree, flattened for rendering with its indent depth. */
export interface PlanRow {
  node: CapturedNode;
  depth: number;
  /** Share of total execution time spent in this node, excluding its children. */
  selfShare: number;
}

/**
 * Flatten a plan for display, attributing time to each node exclusive of its
 * children.
 *
 * EXPLAIN reports *inclusive* time, so a top-level aggregate always looks like
 * the slowest node in the plan simply because everything happens beneath it.
 * Subtracting the children is what turns the tree into an answer to "where did
 * the time go", and it is the first thing anyone reading a plan wants.
 */
export function flatten(plan: CapturedPlan): PlanRow[] {
  // Per-loop times on both sides, normalised against the root's per-loop time.
  //
  // The tempting alternative -- multiply every node by `loops` to get "total
  // work", then divide by `executionMs` -- produces shares that sum to well
  // over 100%. That is not a bug in the arithmetic: three workers really do
  // spend 29ms of CPU inside a query that finished in 12ms of wall-clock. But a
  // breakdown where the parts sum to 280% answers no question a reader has.
  //
  // Comparing a parent against its children in the same per-loop units keeps
  // the tree internally consistent, at the cost of under-weighting a node that
  // runs many times inside a nested loop. That trade is stated rather than
  // hidden because it is the direction that misleads least: it understates a
  // hot inner node instead of inventing time that never elapsed.
  const total = plan.root.actualMs || 1;

  const rows: PlanRow[] = [];
  const visit = (node: CapturedNode, depth: number) => {
    const children = node.children ?? [];
    const childTime = children.reduce((sum, c) => sum + c.actualMs, 0);
    const self = Math.max(0, node.actualMs - childTime);
    rows.push({ node, depth, selfShare: self / total });
    for (const child of children) visit(child, depth + 1);
  };
  visit(plan.root, 0);

  return rows;
}
