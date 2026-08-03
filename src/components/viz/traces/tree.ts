import type { EdgeState, NodeState, VizStep, VizTrace } from '../core/types.ts';

/**
 * Binary tree traversals.
 *
 * All four traversals visit exactly the same nodes over exactly the same edges.
 * The *only* difference is when a node is emitted relative to its children — and
 * that one difference is why in-order sorts a BST, pre-order clones it, and
 * post-order frees it safely. Running them over one shared tree, with an output
 * strip building up underneath, is the clearest way to show that.
 */

export interface TreeNode {
  id: string;
  value: number;
  left?: TreeNode;
  right?: TreeNode;
}

/** Build a BST by inserting in order — the shape depends on insertion order. */
export function buildBst(values: number[]): TreeNode | undefined {
  let root: TreeNode | undefined;

  for (const value of values) {
    const node: TreeNode = { id: `t${value}`, value };
    if (!root) {
      root = node;
      continue;
    }
    let current = root;
    for (;;) {
      if (value < current.value) {
        if (!current.left) {
          current.left = node;
          break;
        }
        current = current.left;
      } else {
        if (!current.right) {
          current.right = node;
          break;
        }
        current = current.right;
      }
    }
  }

  return root;
}

export function flatten(root: TreeNode | undefined): TreeNode[] {
  if (!root) return [];
  return [root, ...flatten(root.left), ...flatten(root.right)];
}

export function heightOf(root: TreeNode | undefined): number {
  if (!root) return 0;
  return 1 + Math.max(heightOf(root.left), heightOf(root.right));
}

function edgesOf(root: TreeNode | undefined): EdgeState[] {
  const edges: EdgeState[] = [];
  const walk = (node: TreeNode) => {
    for (const child of [node.left, node.right]) {
      if (child) {
        edges.push({ from: node.id, to: child.id, directed: true });
        walk(child);
      }
    }
  };
  if (root) walk(root);
  return edges;
}

export type Order = 'inorder' | 'preorder' | 'postorder' | 'levelorder';

export const ORDER_LABELS: Record<Order, string> = {
  inorder: 'in-order (left, node, right)',
  preorder: 'pre-order (node, left, right)',
  postorder: 'post-order (left, right, node)',
  levelorder: 'level-order (breadth-first)',
};

export const TRAVERSAL_CODE: Record<Order, { python: string; typescript: string }> = {
  inorder: {
    python: `def inorder(node, out):
    if not node:
        return
    inorder(node.left, out)    # everything smaller
    out.append(node.value)     # then this node
    inorder(node.right, out)   # then everything larger`,
    typescript: `function inorder(node: Node | null, out: number[]): void {
  if (!node) return;
  inorder(node.left, out);   // everything smaller
  out.push(node.value);      // then this node
  inorder(node.right, out);  // then everything larger
}`,
  },
  preorder: {
    python: `def preorder(node, out):
    if not node:
        return
    out.append(node.value)     # this node first
    preorder(node.left, out)
    preorder(node.right, out)`,
    typescript: `function preorder(node: Node | null, out: number[]): void {
  if (!node) return;
  out.push(node.value);      // this node first
  preorder(node.left, out);
  preorder(node.right, out);
}`,
  },
  postorder: {
    python: `def postorder(node, out):
    if not node:
        return
    postorder(node.left, out)
    postorder(node.right, out)
    out.append(node.value)     # children first, then this node`,
    typescript: `function postorder(node: Node | null, out: number[]): void {
  if (!node) return;
  postorder(node.left, out);
  postorder(node.right, out);
  out.push(node.value);      // children first, then this node
}`,
  },
  levelorder: {
    python: `def levelorder(root):
    out, queue = [], deque([root])
    while queue:
        node = queue.popleft()   # a QUEUE, not the call stack
        out.append(node.value)
        if node.left:  queue.append(node.left)
        if node.right: queue.append(node.right)
    return out`,
    typescript: `function levelorder(root: Node): number[] {
  const out: number[] = [];
  const queue: Node[] = [root];      // a QUEUE, not the call stack
  while (queue.length) {
    const node = queue.shift()!;
    out.push(node.value);
    if (node.left) queue.push(node.left);
    if (node.right) queue.push(node.right);
  }
  return out;
}`,
  },
};

interface Visit {
  /** Node being looked at. */
  id: string;
  /** Emitted to the output on this step? */
  emit?: number;
  caption: string;
  codeLine: number | [number, number];
  /** Nodes still pending — on the call stack, or in the queue. */
  pending: string[];
}

/** Collect the visit sequence for one traversal order. */
function visitsFor(root: TreeNode, order: Order): Visit[] {
  const visits: Visit[] = [];

  if (order === 'levelorder') {
    const queue: TreeNode[] = [root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const children = [node.left, node.right].filter(Boolean) as TreeNode[];
      queue.push(...children);
      visits.push({
        id: node.id,
        emit: node.value,
        caption: `Take ${node.value} off the front of the queue and emit it${
          children.length
            ? `, then enqueue its ${children.length} child${children.length > 1 ? 'ren' : ''}`
            : ''
        }.`,
        codeLine: [4, 8],
        pending: queue.map((n) => n.id),
      });
    }
    return visits;
  }

  const stack: string[] = [];

  const walk = (node: TreeNode) => {
    stack.push(node.id);

    const emitHere = (line: number, why: string) => {
      visits.push({
        id: node.id,
        emit: node.value,
        caption: why,
        codeLine: line,
        pending: [...stack],
      });
    };

    if (order === 'preorder') {
      emitHere(4, `Emit ${node.value} on arrival, before descending anywhere.`);
    }

    if (node.left) {
      visits.push({
        id: node.id,
        caption: `Descend left from ${node.value}.`,
        codeLine: order === 'inorder' ? 4 : 5,
        pending: [...stack],
      });
      walk(node.left);
    }

    if (order === 'inorder') {
      emitHere(
        5,
        `Everything to the left of ${node.value} has been emitted, so ${node.value} comes next. This is why in-order over a BST yields sorted output.`,
      );
    }

    if (node.right) {
      visits.push({
        id: node.id,
        caption: `Descend right from ${node.value}.`,
        codeLine: order === 'inorder' ? 6 : order === 'preorder' ? 6 : 5,
        pending: [...stack],
      });
      walk(node.right);
    }

    if (order === 'postorder') {
      emitHere(
        6,
        `Both subtrees of ${node.value} are finished, so ${node.value} is emitted last. Nothing is emitted before its children — which is what makes post-order the safe order for freeing or deleting.`,
      );
    }

    stack.pop();
  };

  walk(root);
  return visits;
}

export function traceTraversal(root: TreeNode, order: Order): VizTrace {
  const nodes = flatten(root);
  const edges = edgesOf(root);
  const visits = visitsFor(root, order);
  const steps: VizStep[] = [];
  const emitted: number[] = [];
  const counters = { visited: 0, emitted: 0, 'max depth': 0 };

  const frame = (
    caption: string,
    activeId: string | undefined,
    pending: string[],
    codeLine?: number | [number, number],
    phase?: string,
  ): VizStep => {
    const pendingSet = new Set(pending);
    const emittedIds = new Set(
      nodes.filter((n) => emitted.includes(n.value)).map((n) => n.id),
    );

    return {
      caption,
      codeLine,
      counters: { ...counters },
      phase,
      nodes: nodes.map<NodeState>((node) => ({
        id: node.id,
        value: node.value,
        role:
          node.id === activeId
            ? 'active'
            : emittedIds.has(node.id)
              ? 'sorted'
              : pendingSet.has(node.id)
                ? 'compare'
                : 'default',
      })),
      edges,
      // The output-so-far, rendered as a strip beneath the tree.
      cells: emitted.map((value, i) => ({
        id: `out-${i}-${value}`,
        value,
        index: i,
        role: 'sorted' as const,
      })),
      pointers: activeId ? [{ label: 'node', target: activeId }] : [],
    };
  };

  steps.push(
    frame(
      `${ORDER_LABELS[order]}. Every traversal visits the same nodes over the same edges — only the moment a node is emitted differs.`,
      undefined,
      [],
      1,
      'start',
    ),
  );

  for (const visit of visits) {
    counters.visited++;
    counters['max depth'] = Math.max(counters['max depth'], visit.pending.length);

    if (visit.emit !== undefined) {
      emitted.push(visit.emit);
      counters.emitted = emitted.length;
    }

    steps.push(frame(visit.caption, visit.id, visit.pending, visit.codeLine));
  }

  steps.push(
    frame(
      `Done: ${emitted.join(', ')}. ${counters.visited} node visits for ${nodes.length} nodes — every traversal is O(n), and the ${
        order === 'levelorder' ? 'queue' : 'call stack'
      } reached a depth of ${counters['max depth']}, which is the space cost.`,
      undefined,
      [],
      undefined,
      'done',
    ),
  );

  return {
    steps,
    code: TRAVERSAL_CODE[order],
    counterSpec: [
      { key: 'visited', label: 'node visits' },
      { key: 'emitted', label: 'emitted' },
      {
        key: 'max depth',
        label: order === 'levelorder' ? 'max queue size' : 'max stack depth',
      },
    ],
  };
}

/** The output sequence a traversal produces, independent of any rendering. */
export function traversalOutput(root: TreeNode, order: Order): number[] {
  return visitsFor(root, order)
    .filter((v) => v.emit !== undefined)
    .map((v) => v.emit!);
}
