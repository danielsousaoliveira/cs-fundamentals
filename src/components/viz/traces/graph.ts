import type { EdgeState, NodeState, VizStep, VizTrace } from '../core/types.ts';

/**
 * Graph traversals.
 *
 * BFS and DFS differ by exactly one thing: whether the frontier is a queue or a
 * stack. Everything else — the visited set, the neighbour loop, the complexity —
 * is identical. Running them on the same graph, side by side, with the frontier
 * drawn as a strip, is the cleanest way to show that a data-structure choice
 * *is* the algorithm.
 */

export interface Graph {
  nodes: { id: string; label: string; x?: number; y?: number }[];
  edges: { from: string; to: string; weight?: number }[];
}

export const SAMPLE_GRAPH: Graph = {
  nodes: [
    { id: 'A', label: 'A', x: 0, y: 0 },
    { id: 'B', label: 'B', x: 1, y: 0 },
    { id: 'C', label: 'C', x: 2, y: 0 },
    { id: 'D', label: 'D', x: 0, y: 1 },
    { id: 'E', label: 'E', x: 1, y: 1 },
    { id: 'F', label: 'F', x: 2, y: 1 },
    { id: 'G', label: 'G', x: 1, y: 2 },
  ],
  edges: [
    { from: 'A', to: 'B', weight: 4 },
    { from: 'A', to: 'D', weight: 1 },
    { from: 'B', to: 'C', weight: 2 },
    { from: 'B', to: 'E', weight: 5 },
    { from: 'C', to: 'F', weight: 1 },
    { from: 'D', to: 'E', weight: 2 },
    { from: 'E', to: 'F', weight: 3 },
    { from: 'E', to: 'G', weight: 6 },
    { from: 'F', to: 'G', weight: 2 },
  ],
};

/** Undirected adjacency, with neighbours in a stable order. */
export function adjacency(graph: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const edge of graph.edges) {
    adj.get(edge.from)!.push(edge.to);
    adj.get(edge.to)!.push(edge.from);
  }
  for (const list of adj.values()) list.sort();
  return adj;
}

export type Strategy = 'bfs' | 'dfs';

export const TRAVERSAL_CODE: Record<Strategy, { python: string; typescript: string }> =
  {
    bfs: {
      python: `def bfs(graph, start):
    visited = {start}
    frontier = deque([start])       # a QUEUE: first in, first out
    order = []
    while frontier:
        node = frontier.popleft()   # oldest first
        order.append(node)
        for neighbour in graph[node]:
            if neighbour not in visited:
                visited.add(neighbour)   # mark on ENQUEUE, not on visit
                frontier.append(neighbour)
    return order`,
      typescript: `function bfs(graph: Map<string, string[]>, start: string): string[] {
  const visited = new Set([start]);
  const frontier: string[] = [start];   // a QUEUE: first in, first out
  const order: string[] = [];
  while (frontier.length) {
    const node = frontier.shift()!;     // oldest first
    order.push(node);
    for (const neighbour of graph.get(node)!) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);         // mark on ENQUEUE, not on visit
        frontier.push(neighbour);
      }
    }
  }
  return order;
}`,
    },
    dfs: {
      python: `def dfs(graph, start):
    visited = set()
    frontier = [start]              # a STACK: last in, first out
    order = []
    while frontier:
        node = frontier.pop()       # newest first
        if node in visited:
            continue
        visited.add(node)
        order.append(node)
        for neighbour in reversed(graph[node]):
            frontier.append(neighbour)
    return order`,
      typescript: `function dfs(graph: Map<string, string[]>, start: string): string[] {
  const visited = new Set<string>();
  const frontier: string[] = [start];   // a STACK: last in, first out
  const order: string[] = [];
  while (frontier.length) {
    const node = frontier.pop()!;       // newest first
    if (visited.has(node)) continue;
    visited.add(node);
    order.push(node);
    for (const n of [...graph.get(node)!].reverse()) frontier.push(n);
  }
  return order;
}`,
    },
  };

interface GraphFrameInput {
  graph: Graph;
  visited: Set<string>;
  frontier: string[];
  active?: string;
  order: string[];
  caption: string;
  codeLine?: number | [number, number];
  counters: Record<string, number>;
  phase?: string;
  /** Edge "from→to" keys walked so far, for highlighting the traversal tree. */
  treeEdges: Set<string>;
}

const edgeKey = (a: string, b: string) => [a, b].sort().join('-');

function frame(input: GraphFrameInput): VizStep {
  const { graph, visited, frontier, active, treeEdges } = input;
  const frontierSet = new Set(frontier);

  const nodes: NodeState[] = graph.nodes.map((node) => ({
    id: node.id,
    value: node.label,
    x: node.x,
    y: node.y,
    role:
      node.id === active
        ? 'active'
        : visited.has(node.id)
          ? 'sorted'
          : frontierSet.has(node.id)
            ? 'compare'
            : 'default',
  }));

  const edges: EdgeState[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    role: treeEdges.has(edgeKey(edge.from, edge.to)) ? 'active' : 'default',
  }));

  return {
    caption: input.caption,
    codeLine: input.codeLine,
    counters: { ...input.counters },
    phase: input.phase,
    nodes,
    edges,
    // The frontier, drawn as a strip: this is the queue-vs-stack difference.
    cells: frontier.map((id, i) => ({
      id: `f-${id}`,
      value: id,
      index: i,
      role: 'compare' as const,
    })),
    pointers: active ? [{ label: 'node', target: active }] : [],
  };
}

export function traceGraphTraversal(
  graph: Graph,
  start: string,
  strategy: Strategy,
): VizTrace {
  const adj = adjacency(graph);
  const steps: VizStep[] = [];
  const visited = new Set<string>();
  const order: string[] = [];
  const treeEdges = new Set<string>();
  const counters = { visited: 0, 'frontier size': 0, 'max frontier': 0 };

  let frontier: string[] = [start];
  if (strategy === 'bfs') visited.add(start);

  steps.push(
    frame({
      graph,
      visited: new Set(strategy === 'bfs' ? [start] : []),
      frontier,
      order,
      treeEdges,
      counters,
      caption:
        strategy === 'bfs'
          ? `Breadth-first from ${start}. The frontier is a queue, so the oldest node comes out next — which is what keeps the search expanding in rings.`
          : `Depth-first from ${start}. The frontier is a stack, so the newest node comes out next — which is what makes the search plunge.`,
      codeLine: [2, 3],
      phase: 'start',
    }),
  );

  while (frontier.length > 0) {
    const node = strategy === 'bfs' ? frontier.shift()! : frontier.pop()!;

    if (strategy === 'dfs') {
      if (visited.has(node)) continue;
      visited.add(node);
    }

    order.push(node);
    counters.visited = order.length;

    const neighbours = adj.get(node)!;
    const fresh = neighbours.filter((n) => !visited.has(n));

    steps.push(
      frame({
        graph,
        visited,
        frontier,
        active: node,
        order,
        treeEdges,
        counters: { ...counters, 'frontier size': frontier.length },
        caption:
          strategy === 'bfs'
            ? `Dequeue ${node} — it entered the frontier before anything still in it. Visit order so far: ${order.join(' → ')}.`
            : `Pop ${node} — the most recently pushed node. Visit order so far: ${order.join(' → ')}.`,
        codeLine: strategy === 'bfs' ? [6, 7] : [6, 10],
      }),
    );

    for (const neighbour of strategy === 'dfs'
      ? [...neighbours].reverse()
      : neighbours) {
      if (strategy === 'bfs') {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
      } else if (visited.has(neighbour)) {
        continue;
      }
      treeEdges.add(edgeKey(node, neighbour));
      frontier = [...frontier, neighbour];
    }

    counters['frontier size'] = frontier.length;
    counters['max frontier'] = Math.max(counters['max frontier'], frontier.length);

    steps.push(
      frame({
        graph,
        visited,
        frontier,
        active: node,
        order,
        treeEdges,
        counters,
        caption: fresh.length
          ? strategy === 'bfs'
            ? `Enqueue ${fresh.join(', ')} at the back. Marking them visited now — not when they come out — is what stops the same node being queued twice.`
            : `Push ${fresh.join(', ')} on top. The last one pushed is the next one popped, so the search commits to one branch and follows it down.`
          : `${node} has no unvisited neighbours, so the frontier just shrinks.`,
        codeLine: strategy === 'bfs' ? [8, 11] : [11, 12],
      }),
    );
  }

  steps.push(
    frame({
      graph,
      visited,
      frontier: [],
      order,
      treeEdges,
      counters,
      caption: `Visit order: ${order.join(' → ')}. Both strategies touch every node once and every edge twice — O(V + E) — and differ only in the frontier's discipline. Peak frontier here was ${counters['max frontier']}.`,
      phase: 'done',
    }),
  );

  return {
    steps,
    code: TRAVERSAL_CODE[strategy],
    counterSpec: [
      { key: 'visited', label: 'visited' },
      { key: 'frontier size', label: strategy === 'bfs' ? 'queue' : 'stack' },
      { key: 'max frontier', label: 'peak frontier' },
    ],
  };
}

/** Visit order, independent of rendering. */
export function traversalOrder(
  graph: Graph,
  start: string,
  strategy: Strategy,
): string[] {
  const trace = traceGraphTraversal(graph, start, strategy);
  const caption = trace.steps.at(-1)!.caption;
  return caption.replace('Visit order: ', '').split('.')[0]!.split(' → ');
}

/** Shortest-hop distances from `start` — what BFS gives you and DFS does not. */
export function bfsDistances(graph: Graph, start: string): Map<string, number> {
  const adj = adjacency(graph);
  const dist = new Map([[start, 0]]);
  const queue = [start];

  while (queue.length) {
    const node = queue.shift()!;
    for (const neighbour of adj.get(node)!) {
      if (!dist.has(neighbour)) {
        dist.set(neighbour, dist.get(node)! + 1);
        queue.push(neighbour);
      }
    }
  }
  return dist;
}
