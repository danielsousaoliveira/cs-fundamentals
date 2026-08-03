import { describe, expect, it } from 'vitest';
import {
  buildBst,
  flatten,
  heightOf,
  traceTraversal,
  traversalOutput,
  type Order,
} from './tree.ts';

const VALUES = [50, 30, 70, 20, 40, 60, 80];
const tree = () => buildBst(VALUES)!;

describe('buildBst', () => {
  it('keeps the search invariant: left < node <= right', () => {
    const check = (node = tree()): void => {
      if (node.left) {
        expect(node.left.value).toBeLessThan(node.value);
        check(node.left);
      }
      if (node.right) {
        expect(node.right.value).toBeGreaterThanOrEqual(node.value);
        check(node.right);
      }
    };
    check();
  });

  it('degenerates into a list when values arrive sorted', () => {
    // The failure mode the page warns about, asserted rather than described.
    const sorted = buildBst([1, 2, 3, 4, 5, 6, 7])!;
    expect(heightOf(sorted)).toBe(7);
    expect(heightOf(tree())).toBe(3);
  });
});

describe('traversal output', () => {
  it('in-order over a BST is sorted — the defining property', () => {
    expect(traversalOutput(tree(), 'inorder')).toEqual([20, 30, 40, 50, 60, 70, 80]);
  });

  it('pre-order emits a node before either subtree', () => {
    expect(traversalOutput(tree(), 'preorder')).toEqual([50, 30, 20, 40, 70, 60, 80]);
  });

  it('post-order emits a node after both subtrees', () => {
    expect(traversalOutput(tree(), 'postorder')).toEqual([20, 40, 30, 60, 80, 70, 50]);
  });

  it('level-order emits top to bottom, left to right', () => {
    expect(traversalOutput(tree(), 'levelorder')).toEqual([50, 30, 70, 20, 40, 60, 80]);
  });

  const orders: Order[] = ['inorder', 'preorder', 'postorder', 'levelorder'];

  it.each(orders)('%s visits every node exactly once', (order) => {
    const output = traversalOutput(tree(), order);
    expect([...output].sort((a, b) => a - b)).toEqual(
      [...VALUES].sort((a, b) => a - b),
    );
  });

  it('post-order never emits a parent before its children', () => {
    // This is the property that makes post-order safe for freeing a tree.
    const output = traversalOutput(tree(), 'postorder');
    const positionOf = (v: number) => output.indexOf(v);

    const check = (node = tree()): void => {
      for (const child of [node.left, node.right]) {
        if (child) {
          expect(positionOf(child.value)).toBeLessThan(positionOf(node.value));
          check(child);
        }
      }
    };
    check();
  });

  it('pre-order never emits a child before its parent', () => {
    const output = traversalOutput(tree(), 'preorder');
    const check = (node = tree()): void => {
      for (const child of [node.left, node.right]) {
        if (child) {
          expect(output.indexOf(node.value)).toBeLessThan(output.indexOf(child.value));
          check(child);
        }
      }
    };
    check();
  });
});

describe('traceTraversal', () => {
  const orders: Order[] = ['inorder', 'preorder', 'postorder', 'levelorder'];

  it.each(orders)('%s: the animation agrees with the algorithm', (order) => {
    const trace = traceTraversal(tree(), order);
    const shown = trace.steps.at(-1)!.cells!.map((c) => c.value);

    expect(shown).toEqual(traversalOutput(tree(), order));
  });

  it.each(orders)('%s: every step captions itself', (order) => {
    for (const step of traceTraversal(tree(), order).steps) {
      expect(step.caption.length).toBeGreaterThan(0);
    }
  });

  it.each(orders)('%s: counts one visit per node', (order) => {
    const trace = traceTraversal(tree(), order);
    expect(trace.steps.at(-1)!.counters!.emitted).toBe(flatten(tree()).length);
  });

  it('reports a stack depth bounded by the tree height', () => {
    const trace = traceTraversal(tree(), 'inorder');
    expect(trace.steps.at(-1)!.counters!['max depth']).toBeLessThanOrEqual(
      heightOf(tree()),
    );
  });

  it('level-order queue never exceeds the widest level', () => {
    const trace = traceTraversal(tree(), 'levelorder');
    // A 7-node perfect tree's widest level holds 4 nodes.
    expect(trace.steps.at(-1)!.counters!['max depth']).toBeLessThanOrEqual(4);
  });
});
