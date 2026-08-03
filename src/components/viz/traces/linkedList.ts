import type { EdgeState, NodeState, VizStep, VizTrace } from '../core/types.ts';

/**
 * Linked list traces.
 *
 * The thing worth showing here is not that a list holds values — it is the
 * **pointer surgery**: which `next` is reassigned, in what order, and what the
 * structure looks like in the half-second where it is temporarily broken. Get
 * the order wrong and you either leak the tail or lose it, and both mistakes are
 * far more legible as a picture than as prose.
 */

export interface ListNode {
  id: string;
  value: number;
}

export function makeList(values: number[]): ListNode[] {
  return values.map((value, i) => ({ id: `n${i}-${value}`, value }));
}

interface FrameOptions {
  caption: string;
  codeLine?: number | [number, number];
  counters: { steps: number };
  /** Node index → role. */
  roles?: Record<number, NodeState['role']>;
  /** Node index → pointer label, e.g. `{ 0: 'head', 2: 'current' }`. */
  pointers?: Record<number, string>;
  phase?: string;
  /**
   * Edges to suppress or add, for the moments mid-surgery when the `next`
   * pointers do not match the node order.
   */
  edgeOverride?: EdgeState[];
  /** Index of a node that is detached from the list but not yet gone. */
  orphan?: number;
}

function frame(nodes: ListNode[], options: FrameOptions): VizStep {
  const { roles = {}, orphan } = options;

  const nodeStates: NodeState[] = nodes.map((node, i) => ({
    id: node.id,
    value: node.value,
    role: i === orphan ? 'ghost' : (roles[i] ?? 'default'),
  }));

  const edges: EdgeState[] =
    options.edgeOverride ??
    nodes.slice(0, -1).map((node, i) => ({
      from: node.id,
      to: nodes[i + 1]!.id,
      directed: true,
      role:
        orphan !== undefined && (i === orphan || i + 1 === orphan)
          ? 'ghost'
          : 'default',
    }));

  return {
    caption: options.caption,
    codeLine: options.codeLine,
    counters: { ...options.counters },
    phase: options.phase,
    nodes: nodeStates,
    edges,
    // A pointer with no node to point at is dropped rather than dangling: an
    // empty list still has a `head`, it just has nothing to aim it at.
    pointers: Object.entries(options.pointers ?? {}).flatMap(([index, label]) => {
      const target = nodes[Number(index)];
      return target ? [{ label, target: target.id }] : [];
    }),
  };
}

export const PREPEND_CODE = {
  python: `def prepend(self, value):
    node = Node(value)
    node.next = self.head   # 1. point the new node at the old first
    self.head = node        # 2. only then move head
    # Reversing these two lines loses the entire rest of the list.`,
  typescript: `prepend(value: number): void {
  const node = new Node(value);
  node.next = this.head;    // 1. point the new node at the old first
  this.head = node;         // 2. only then move head
  // Reversing these two lines loses the entire rest of the list.
}`,
} as const;

export const APPEND_CODE = {
  python: `def append(self, value):
    node = Node(value)
    if not self.head:
        self.head = node
        return
    current = self.head
    while current.next:     # no tail pointer: walk the whole list
        current = current.next
    current.next = node`,
  typescript: `append(value: number): void {
  const node = new Node(value);
  if (!this.head) {
    this.head = node;
    return;
  }
  let current = this.head;
  while (current.next) {    // no tail pointer: walk the whole list
    current = current.next;
  }
  current.next = node;
}`,
} as const;

export const DELETE_CODE = {
  python: `def delete(self, value):
    if not self.head:
        return
    if self.head.value == value:
        self.head = self.head.next
        return
    current = self.head
    while current.next and current.next.value != value:
        current = current.next          # find the node BEFORE it
    if current.next:
        current.next = current.next.next  # splice it out`,
  typescript: `delete(value: number): void {
  if (!this.head) return;
  if (this.head.value === value) {
    this.head = this.head.next;
    return;
  }
  let current = this.head;
  while (current.next && current.next.value !== value) {
    current = current.next;             // find the node BEFORE it
  }
  if (current.next) {
    current.next = current.next.next;   // splice it out
  }
}`,
} as const;

const SPEC = [{ key: 'steps', label: 'pointers followed' }];

/** Prepend: the operation linked lists are supposed to be good at. */
export function tracePrepend(list: ListNode[], value: number): VizTrace {
  const counters = { steps: 0 };
  const steps: VizStep[] = [];
  const node: ListNode = { id: `new-${Date.now()}-${value}`, value };
  const withNew = [node, ...list];

  steps.push(
    frame(list, {
      caption: `The list before. \`head\` points at the first node; every other node is reachable only by following \`next\` from there.`,
      codeLine: 1,
      counters,
      pointers: { 0: 'head' },
      phase: 'prepend',
    }),
  );

  // The new node exists but nothing points at it yet.
  steps.push(
    frame(withNew, {
      caption: `Allocate a node holding ${value}. It is not in the list yet — nothing points at it, and it points at nothing.`,
      codeLine: 2,
      counters,
      roles: { 0: 'active' },
      pointers: { 1: 'head' },
      edgeOverride: list.slice(0, -1).map((n, i) => ({
        from: n.id,
        to: list[i + 1]!.id,
        directed: true,
      })),
    }),
  );

  steps.push(
    frame(withNew, {
      caption: `Point the new node's \`next\` at the current head. Both now point at the same node — that overlap is what makes the operation safe.`,
      codeLine: 3,
      counters,
      roles: { 0: 'active' },
      pointers: { 1: 'head' },
    }),
  );

  counters.steps++;

  steps.push(
    frame(withNew, {
      caption: `Move \`head\`. Done — no shifting, no copying, no reallocation, however long the list is. That is the O(1) a linked list actually delivers.`,
      codeLine: 4,
      counters,
      roles: { 0: 'sorted' },
      pointers: { 0: 'head' },
      phase: 'done',
    }),
  );

  return { steps, code: PREPEND_CODE, counterSpec: SPEC };
}

/** Append: the operation that looks symmetric and is not. */
export function traceAppend(list: ListNode[], value: number): VizTrace {
  const counters = { steps: 0 };
  const steps: VizStep[] = [];
  const node: ListNode = { id: `new-${Date.now()}-${value}`, value };

  steps.push(
    frame(list, {
      caption: `Appending looks like the mirror of prepending. It is not: there is no pointer to the end, so the end has to be found.`,
      codeLine: 1,
      counters,
      pointers: { 0: 'head' },
      phase: 'append',
    }),
  );

  for (let i = 0; i < list.length; i++) {
    counters.steps++;
    steps.push(
      frame(list, {
        caption:
          i === list.length - 1
            ? `Node ${list[i]!.value} has no \`next\`, so this is the tail. Found it after ${counters.steps} hops.`
            : `Follow \`next\` to node ${list[i]!.value}. Still not the end.`,
        codeLine: [6, 8],
        counters,
        roles: { [i]: i === list.length - 1 ? 'sorted' : 'compare' },
        pointers: { [i]: 'current' },
      }),
    );
  }

  const withNew = [...list, node];
  steps.push(
    frame(withNew, {
      caption: `Link the tail to the new node. The link itself was O(1); getting to it cost ${counters.steps} pointer hops — so append on a singly linked list without a tail pointer is O(n).`,
      codeLine: 9,
      counters,
      roles: { [withNew.length - 1]: 'active' },
      pointers: { 0: 'head' },
      phase: 'done',
    }),
  );

  return { steps, code: APPEND_CODE, counterSpec: SPEC };
}

/** Delete by value: the splice, and why you must find the *previous* node. */
export function traceDelete(list: ListNode[], value: number): VizTrace {
  const counters = { steps: 0 };
  const steps: VizStep[] = [];
  const target = list.findIndex((node) => node.value === value);

  steps.push(
    frame(list, {
      caption: `To remove ${value}, the node before it must be found — a singly linked list has no way back, so you cannot delete a node you are standing on.`,
      codeLine: 1,
      counters,
      pointers: { 0: 'head' },
      phase: 'delete',
    }),
  );

  if (target === -1) {
    steps.push(
      frame(list, {
        caption: `${value} is not in the list. Finding that out required walking all of it — O(n), the same as any other search here.`,
        counters: { steps: list.length },
        phase: 'done',
      }),
    );
    return { steps, code: DELETE_CODE, counterSpec: SPEC };
  }

  if (target === 0) {
    steps.push(
      frame(list, {
        caption: `${value} is at the head — the one case that needs no search. Move \`head\` to the second node.`,
        codeLine: [3, 5],
        counters,
        roles: { 0: 'swap' },
        pointers: { 0: 'head' },
      }),
    );

    const rest = list.slice(1);
    steps.push(
      frame(rest, {
        caption: `Removed. The old node is now unreachable — garbage-collected in Python and JavaScript, and a memory leak in C if you forgot to free it.`,
        codeLine: 5,
        counters,
        pointers: rest.length ? { 0: 'head' } : {},
        phase: 'done',
      }),
    );
    return { steps, code: DELETE_CODE, counterSpec: SPEC };
  }

  for (let i = 0; i < target - 1; i++) {
    counters.steps++;
    steps.push(
      frame(list, {
        caption: `Walk to node ${list[i]!.value}, checking whether the *next* node is the one to remove.`,
        codeLine: [7, 9],
        counters,
        roles: { [i]: 'compare', [i + 1]: 'compare' },
        pointers: { [i]: 'current' },
      }),
    );
  }

  counters.steps++;
  steps.push(
    frame(list, {
      caption: `Node ${list[target - 1]!.value} points at ${value}. This is the node that has to change.`,
      codeLine: 10,
      counters,
      roles: { [target - 1]: 'active', [target]: 'swap' },
      pointers: { [target - 1]: 'current' },
      orphan: target,
    }),
  );

  const without = list.filter((_, i) => i !== target);
  steps.push(
    frame(without, {
      caption: `Splice: point it past the removed node. One assignment — the deletion itself is O(1), and every bit of the cost was the search that preceded it.`,
      codeLine: 11,
      counters,
      roles: { [target - 1]: 'sorted' },
      pointers: { 0: 'head' },
      phase: 'done',
    }),
  );

  return { steps, code: DELETE_CODE, counterSpec: SPEC };
}

export function traceIdle(list: ListNode[]): VizTrace {
  return {
    steps: [
      frame(list, {
        caption:
          'Nodes scattered anywhere in memory, held together by pointers. Nothing here is contiguous — which is the source of every advantage and every cost.',
        counters: { steps: 0 },
        pointers: { 0: 'head' },
      }),
    ],
    code: PREPEND_CODE,
    counterSpec: SPEC,
  };
}

/** Final list state after a trace. */
export function finalList(trace: VizTrace): ListNode[] {
  const last = trace.steps.at(-1)!;
  return (last.nodes ?? [])
    .filter((node) => node.role !== 'ghost')
    .map((node) => ({ id: node.id, value: node.value as number }));
}
