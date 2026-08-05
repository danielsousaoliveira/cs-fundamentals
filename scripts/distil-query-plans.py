#!/usr/bin/env python3
"""
Distil the raw EXPLAIN capture into the compact fixture the widget imports.

Why this exists: `queryPlans.json` is the full `EXPLAIN (FORMAT JSON)` output at
~188 KB. Shipping that to a browser to render a plan tree would be absurd, and
hand-copying numbers out of it into a .ts file would reintroduce exactly the
transcription risk the capture script exists to remove.

So this reads the raw capture and emits `queryPlans.ts` with only the fields the
widget and the pages actually display. The raw JSON stays in the repo as the
evidence; the .ts is generated and should never be edited by hand.

    scripts/capture-query-plans.sh > src/components/viz/traces/fixtures/queryPlans.json
    python3 scripts/distil-query-plans.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'src/components/viz/traces/fixtures/queryPlans.json')
OUT = os.path.join(ROOT, 'src/components/viz/traces/fixtures/queryPlans.ts')


def node(n):
    """Keep the fields a reader is actually taught to look at in a plan."""
    out = {
        'nodeType': n['Node Type'],
        'estRows': n['Plan Rows'],
        'actualRows': n['Actual Rows'],
        'loops': n['Actual Loops'],
        'estCost': round(n['Total Cost'], 2),
        'actualMs': round(n['Actual Total Time'], 3),
        'buffers': n.get('Shared Hit Blocks', 0) + n.get('Shared Read Blocks', 0),
    }
    if n.get('Relation Name'):
        out['relation'] = n['Relation Name']
    if n.get('Index Name'):
        out['indexName'] = n['Index Name']
    if n.get('Index Cond'):
        out['indexCond'] = n['Index Cond']
    if n.get('Filter'):
        out['filter'] = n['Filter']
    if n.get('Rows Removed by Filter'):
        out['rowsRemoved'] = n['Rows Removed by Filter']
    if 'Heap Fetches' in n:
        out['heapFetches'] = n['Heap Fetches']
    if n.get('Workers Launched'):
        out['workers'] = n['Workers Launched']
    if n.get('Plans'):
        out['children'] = [node(c) for c in n['Plans']]
    return out


def plan(p):
    top = p[0]
    return {
        'planningMs': round(top.get('Planning Time', 0), 3),
        'executionMs': round(top['Execution Time'], 3),
        'root': node(top['Plan']),
    }


raw = json.load(open(RAW))

out = {
    'capturedAt': raw['capturedAt'],
    'version': raw['version'],
    'rowCount': raw['rowCount'],
    'tableBytes': raw['tableBytes'],
    'indexSizes': raw['indexSizes'],
    'matrix': [
        {'index': c['index'], 'status': c['status'], **plan(c['plan'])}
        for c in raw['matrix']
    ],
    'sweep': [
        {'pct': c['pct'], 'query': c['query'], **plan(c['plan'])}
        for c in raw['sweep']
    ],
    'scenarios': {k: plan(v) for k, v in raw['scenarios'].items()},
}

body = json.dumps(out, indent=2)

header = '''/**
 * Real Postgres plans, captured — not written.
 *
 * GENERATED FILE. Do not edit by hand.
 *   scripts/capture-query-plans.sh > .../queryPlans.json
 *   python3 scripts/distil-query-plans.py
 *
 * Every number below came out of `EXPLAIN (ANALYZE, BUFFERS)` on a real
 * PostgreSQL instance against a 500,000-row table. The capture script is
 * committed beside this file, so any claim a page makes about these plans can be
 * re-derived rather than taken on trust.
 *
 * Two properties of the dataset carry most of the teaching weight:
 *
 *   - `status` is skewed 92/5/2/1, so a single index on it is declined by the
 *     planner for the common value and chosen for the rare ones. The index is
 *     not "good" or "bad"; the *query* decides.
 *   - `status` and `country` are deterministically anti-correlated, so the
 *     planner's independence assumption fails visibly: it estimates hundreds of
 *     rows where the true answer is zero.
 *
 * Timings are from one machine on one run and will differ on yours. The *shape*
 * — which node type wins, how many buffers it touches, how far the estimate is
 * from the actual — is the part that reproduces, and the part the pages rely on.
 */

export interface CapturedNode {
  nodeType: string;
  estRows: number;
  /** Per-loop average. In a parallel plan this is per worker — multiply by loops. */
  actualRows: number;
  loops: number;
  estCost: number;
  actualMs: number;
  /** Shared hit + read blocks, 8 KB each. The truest measure of work done. */
  buffers: number;
  relation?: string;
  indexName?: string;
  indexCond?: string;
  filter?: string;
  rowsRemoved?: number;
  /** Present only on an Index Only Scan. Non-zero means the visibility map is stale. */
  heapFetches?: number;
  workers?: number;
  children?: CapturedNode[];
}

export interface CapturedPlan {
  planningMs: number;
  executionMs: number;
  root: CapturedNode;
}

export interface MatrixCell extends CapturedPlan {
  index: 'absent' | 'present';
  status: 'complete' | 'pending' | 'refunded' | 'cancelled';
}

export interface SweepPoint extends CapturedPlan {
  /** Percentage of the `amount_cents` range matched by the predicate. */
  pct: number;
  /** `indexOnly` can be answered from the index; `heap` must visit the table. */
  query: 'indexOnly' | 'heap';
}

export interface CapturedPlans {
  capturedAt: string;
  version: string;
  rowCount: number;
  tableBytes: number;
  indexSizes: { name: string; bytes: number }[];
  matrix: MatrixCell[];
  sweep: SweepPoint[];
  scenarios: Record<string, CapturedPlan>;
}

export const CAPTURED: CapturedPlans = '''

with open(OUT, 'w') as f:
    f.write(header + body + ';\n')

print('wrote {} ({:.1f} KB)'.format(OUT, os.path.getsize(OUT) / 1024))
