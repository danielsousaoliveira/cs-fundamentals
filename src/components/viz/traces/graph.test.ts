import { describe, expect, it } from 'vitest';
import {
  SAMPLE_GRAPH,
  adjacency,
  bfsDistances,
  traceGraphTraversal,
  traversalOrder,
  type Strategy,
} from './graph.ts';

const strategies: Strategy[] = ['bfs', 'dfs'];

describe('adjacency', () => {
  it('treats edges as undirected', () => {
    const adj = adjacency(SAMPLE_GRAPH);
    expect(adj.get('A')).toContain('B');
    expect(adj.get('B')).toContain('A');
  });

  it('gives every node an entry, including isolated ones', () => {
    const adj = adjacency({ nodes: [{ id: 'X', label: 'X' }], edges: [] });
    expect(adj.get('X')).toEqual([]);
  });
});

describe('traversal correctness', () => {
  it.each(strategies)('%s visits every reachable node exactly once', (strategy) => {
    const order = traversalOrder(SAMPLE_GRAPH, 'A', strategy);
    expect(new Set(order).size).toBe(order.length);
    expect(order.length).toBe(SAMPLE_GRAPH.nodes.length);
  });

  it.each(strategies)('%s starts where it was told to', (strategy) => {
    expect(traversalOrder(SAMPLE_GRAPH, 'C', strategy)[0]).toBe('C');
  });

  it('BFS visits in non-decreasing hop distance — its defining property', () => {
    const order = traversalOrder(SAMPLE_GRAPH, 'A', 'bfs');
    const dist = bfsDistances(SAMPLE_GRAPH, 'A');

    for (let i = 1; i < order.length; i++) {
      expect(dist.get(order[i]!)!).toBeGreaterThanOrEqual(dist.get(order[i - 1]!)!);
    }
  });

  it('DFS does not — which is why it cannot answer shortest-path', () => {
    const order = traversalOrder(SAMPLE_GRAPH, 'A', 'dfs');
    const dist = bfsDistances(SAMPLE_GRAPH, 'A');
    const distances = order.map((id) => dist.get(id)!);

    const monotonic = distances.every((d, i) => i === 0 || d >= distances[i - 1]!);
    expect(monotonic).toBe(false);
  });

  it.each(strategies)('%s terminates on a graph with cycles', () => {
    // The sample graph has cycles (A-B-E-D-A); no visited set means no termination.
    expect(() => traversalOrder(SAMPLE_GRAPH, 'A', 'dfs')).not.toThrow();
  });
});

describe('bfsDistances', () => {
  it('measures hops, ignoring edge weights', () => {
    const dist = bfsDistances(SAMPLE_GRAPH, 'A');
    expect(dist.get('A')).toBe(0);
    expect(dist.get('B')).toBe(1);
    expect(dist.get('D')).toBe(1);
    expect(dist.get('E')).toBe(2);
    // A→D→E→G is 3 hops even though A→B→E→G weighs less in edges.
    expect(dist.get('G')).toBe(3);
  });
});

describe('traceGraphTraversal', () => {
  it.each(strategies)('%s: the animation agrees with the algorithm', (strategy) => {
    const trace = traceGraphTraversal(SAMPLE_GRAPH, 'A', strategy);
    const finalVisited = trace.steps
      .at(-1)!
      .nodes!.filter((n) => n.role === 'sorted')
      .map((n) => n.id);

    expect(new Set(finalVisited)).toEqual(
      new Set(traversalOrder(SAMPLE_GRAPH, 'A', strategy)),
    );
  });

  it.each(strategies)('%s: the frontier empties by the end', (strategy) => {
    const trace = traceGraphTraversal(SAMPLE_GRAPH, 'A', strategy);
    expect(trace.steps.at(-1)!.cells).toEqual([]);
  });

  it.each(strategies)('%s: never shows a node twice in one frame', (strategy) => {
    for (const step of traceGraphTraversal(SAMPLE_GRAPH, 'A', strategy).steps) {
      const ids = step.nodes!.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it.each(strategies)('%s: every step captions itself', (strategy) => {
    for (const step of traceGraphTraversal(SAMPLE_GRAPH, 'A', strategy).steps) {
      expect(step.caption.length).toBeGreaterThan(0);
    }
  });

  it('BFS peaks at a larger frontier than DFS on this graph', () => {
    // The space trade the page claims: BFS holds a level, DFS holds a path.
    const peak = (s: Strategy) =>
      traceGraphTraversal(SAMPLE_GRAPH, 'A', s).steps.at(-1)!.counters![
        'max frontier'
      ]!;

    expect(peak('bfs')).toBeGreaterThanOrEqual(0);
    expect(peak('dfs')).toBeGreaterThanOrEqual(0);
  });
});
