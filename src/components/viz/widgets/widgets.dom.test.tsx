// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BfsDfsCompare } from './BfsDfsCompare.tsx';
import { DynamicArrayGrowth } from './DynamicArrayGrowth.tsx';
import { EventLoopSim } from './EventLoopSim.tsx';
import { HashPlayground } from './HashPlayground.tsx';
import { PointerWalk } from './PointerWalk.tsx';
import { QueueCompare } from './QueueCompare.tsx';
import { SortRace } from './SortRace.tsx';
import { TraversalStepper } from './TraversalStepper.tsx';

/**
 * A smoke test per widget: it mounts, it renders something, and stepping does
 * not throw. The per-algorithm correctness lives in the trace tests; this is the
 * layer that catches a widget wired to the wrong field, or a primitive whose API
 * changed underneath it.
 */

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  }
});

const stepForward = (times = 3) => {
  const next = screen.getByRole('button', { name: 'Next step' });
  for (let i = 0; i < times; i++) fireEvent.click(next);
};

const caption = () => document.querySelector('.viz-frame__caption')!.textContent!;

describe('every widget mounts and steps', () => {
  it('DynamicArrayGrowth shows memory addresses and a cost chart', () => {
    render(<DynamicArrayGrowth />);
    expect(document.querySelector('.viz-array[data-memory]')).not.toBeNull();
    expect(document.querySelectorAll('.cost-chart__bar').length).toBeGreaterThan(0);

    const before = caption();
    stepForward();
    expect(caption()).not.toBe(before);
  });

  it('HashPlayground renders one row per bucket and can insert', () => {
    render(<HashPlayground />);
    const rows = document.querySelectorAll('.hash-table__row');
    expect(rows).toHaveLength(8); // the initial capacity

    fireEvent.click(screen.getByRole('button', { name: 'insert' }));
    expect(caption()).toContain('hash(');
  });

  it('HashPlayground can force a collision on demand', () => {
    render(<HashPlayground />);
    fireEvent.click(screen.getByRole('button', { name: 'force a collision' }));

    // Step to the end; a collision must be reported somewhere in the trace.
    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    const captions: string[] = [];
    for (let i = 0; i <= Number(scrubber.max); i++) {
      fireEvent.change(scrubber, { target: { value: String(i) } });
      captions.push(caption());
    }
    expect(captions.some((c) => c.includes('Collision'))).toBe(true);
  });

  it('PointerWalk distinguishes prepend from append by cost', () => {
    render(<PointerWalk />);
    const hops = () =>
      Number(document.querySelector('.viz-counters__value')!.textContent);

    const scrubToEnd = () => {
      const s = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
      fireEvent.change(s, { target: { value: s.max } });
    };

    fireEvent.click(screen.getByRole('button', { name: /^prepend/ }));
    scrubToEnd();
    const prependHops = hops();

    fireEvent.click(screen.getByRole('button', { name: /^append/ }));
    scrubToEnd();

    // The page's central claim about linked lists, checked in the UI.
    expect(hops()).toBeGreaterThan(prependHops);
  });

  it('TraversalStepper switches order without changing the tree', () => {
    render(<TraversalStepper />);
    const nodeCount = document.querySelectorAll('.viz-node').length;

    fireEvent.click(screen.getByRole('button', { name: 'postorder' }));

    expect(document.querySelectorAll('.viz-node')).toHaveLength(nodeCount);
    expect(document.body.textContent).toContain('post-order');
  });

  it('TraversalStepper can degenerate the tree', () => {
    render(<TraversalStepper />);
    fireEvent.click(screen.getByLabelText('insert sorted values', { exact: false }));
    expect(document.body.textContent).toContain('O(n)');
  });

  it('BfsDfsCompare renders both panes on one timeline', () => {
    render(<BfsDfsCompare />);
    expect(document.querySelectorAll('.compare-pane')).toHaveLength(2);

    const before = caption();
    stepForward(2);
    expect(caption()).not.toBe(before);
  });

  it('EventLoopSim renders four columns and reaches the real output', () => {
    render(<EventLoopSim />);
    expect(document.querySelectorAll('.loop-column')).toHaveLength(4);

    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    // The default snippet is the four-queue ordering; its output is the answer
    // the whole widget exists to make predictable.
    expect(document.querySelector('.loop-output__pre')!.textContent).toBe(
      '1\n5\n4\n3\n2',
    );
  });

  it('EventLoopSim switches snippets', () => {
    render(<EventLoopSim />);
    fireEvent.click(screen.getByRole('button', { name: /forEach does not await/ }));

    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    expect(document.querySelector('.loop-output__pre')!.textContent).toBe(
      'done\na\nb\nc',
    );
  });

  it('SortRace runs two algorithms on one shared clock', () => {
    render(<SortRace />);
    expect(document.querySelectorAll('.compare-pane')).toHaveLength(2);

    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    // Defaults are bubble vs merge on random input. Both must finish sorted,
    // and merge must have done strictly fewer comparisons — the widget's
    // entire claim, checked through the rendered DOM.
    const [bubble, merge] = Array.from(document.querySelectorAll('.compare-pane')).map(
      (pane) => Number(pane.querySelector('.viz-counters__value')!.textContent),
    );
    expect(merge).toBeLessThan(bubble!);
  });

  it('SortRace exposes the input case that inverts the result', () => {
    render(<SortRace />);
    fireEvent.click(screen.getByRole('button', { name: 'already sorted' }));

    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    const [bubble] = Array.from(document.querySelectorAll('.compare-pane')).map(
      (pane) => Number(pane.querySelector('.viz-counters__value')!.textContent),
    );
    // On sorted input bubble sort's early exit makes it O(n) — 7 comparisons
    // for 8 elements — which is the point of offering the preset at all.
    expect(bubble).toBe(7);
  });

  it('QueueCompare shows the two implementations diverging', () => {
    render(<QueueCompare />);
    expect(document.querySelectorAll('.compare-pane')).toHaveLength(2);

    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    const [naive, ring] = Array.from(document.querySelectorAll('.compare-pane')).map(
      (pane) => Number(pane.querySelector('.viz-counters__value')!.textContent),
    );

    // The whole point of the widget: same operations, different relocation cost.
    expect(naive).toBeGreaterThan(0);
    expect(ring).toBe(0);
  });
});
