import type { EdgeState, NodeState } from './types.ts';

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

export type LayoutKind = 'tree' | 'circle' | 'grid';

const H_GAP = 62;
const V_GAP = 78;
const PADDING = 40;

/**
 * A tidy tree layout (the Reingold–Tilford idea, without the threading
 * optimisation — these trees have tens of nodes, not thousands).
 *
 * Leaves are placed left to right at a fixed spacing; every internal node sits
 * at the midpoint of its children. That single rule is what makes a binary heap
 * look like the textbook picture, and it generalises to n-ary trees for free.
 *
 * Deliberately local rather than a d3 dependency: we need the arithmetic, not a
 * DOM selection layer.
 */
function layoutTree(nodes: NodeState[], edges: EdgeState[]): Positioned[] {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const node of nodes) children.set(node.id, []);
  for (const edge of edges) {
    children.get(edge.from)?.push(edge.to);
    hasParent.add(edge.to);
  }

  const roots = nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
  const positions = new Map<string, Positioned>();
  let nextLeafX = 0;

  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    let x: number;

    if (kids.length === 0) {
      x = nextLeafX;
      nextLeafX += H_GAP;
    } else {
      const kidXs = kids.map((kid) => place(kid, depth + 1));
      x = (Math.min(...kidXs) + Math.max(...kidXs)) / 2;
    }

    positions.set(id, { id, x: x + PADDING, y: depth * V_GAP + PADDING });
    return x;
  };

  for (const root of roots) {
    place(root, 0);
    // Gap between disconnected components so they don't visually merge.
    nextLeafX += H_GAP;
  }

  // Any node unreachable from a root (a cycle, or a malformed edge list) still
  // gets a position rather than collapsing to 0,0 on top of everything else.
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { id: node.id, x: nextLeafX + PADDING, y: PADDING });
      nextLeafX += H_GAP;
    }
  }

  return nodes.map((n) => positions.get(n.id)!);
}

function layoutCircle(nodes: NodeState[]): Positioned[] {
  const radius = Math.max(90, (nodes.length * H_GAP) / (2 * Math.PI));
  const cx = radius + PADDING;
  const cy = radius + PADDING;

  return nodes.map((node, i) => {
    // Start at the top and go clockwise, so node order reads like a clock face.
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
    return {
      id: node.id,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function layoutGrid(nodes: NodeState[]): Positioned[] {
  return nodes.map((node, i) => ({
    id: node.id,
    x: (node.x ?? i % 5) * H_GAP + PADDING,
    y: (node.y ?? Math.floor(i / 5)) * V_GAP + PADDING,
  }));
}

export function layoutNodes(
  kind: LayoutKind,
  nodes: NodeState[],
  edges: EdgeState[],
): Map<string, Positioned> {
  if (nodes.length === 0) return new Map();

  const positioned =
    kind === 'tree'
      ? layoutTree(nodes, edges)
      : kind === 'circle'
        ? layoutCircle(nodes)
        : layoutGrid(nodes);

  return new Map(positioned.map((p) => [p.id, p]));
}

/** Bounding box for the SVG viewBox, with room for node radius and labels. */
export function boundsOf(positions: Map<string, Positioned>, radius: number) {
  const values = [...positions.values()];
  if (values.length === 0) return { width: 100, height: 100 };

  return {
    width: Math.max(...values.map((p) => p.x)) + radius + PADDING,
    height: Math.max(...values.map((p) => p.y)) + radius + PADDING,
  };
}
