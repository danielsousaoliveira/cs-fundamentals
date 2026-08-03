import { describe, expect, it } from 'vitest';
import {
  SNIPPETS,
  finalOutput,
  snippetById,
  traceSnippet,
  type EventLoopStep,
} from './eventLoop.ts';

/**
 * The governing rule for this file: **the simulation must agree with the real
 * runtime.** Each snippet's `expected` array was produced by running the code in
 * Node and copying the output. If a change to the simulator makes a snippet
 * disagree with that recording, the widget has started lying and the test fails.
 */

describe('every curated snippet reproduces the real output', () => {
  for (const snippet of SNIPPETS) {
    it(`${snippet.id}: ${snippet.expected.join(' ')}`, () => {
      expect(finalOutput(traceSnippet(snippet))).toEqual(snippet.expected);
    });
  }
});

describe('the scheduling rules the visual claims to show', () => {
  const columns = (
    steps: EventLoopStep[],
    q: 'stack' | 'nextTick' | 'micro' | 'macro',
  ) => steps.map((step) => step.columns[q].length);

  it('never runs a queued job while the stack is occupied', () => {
    for (const snippet of SNIPPETS) {
      const { steps } = traceSnippet(snippet);
      for (const step of steps) {
        // At most one job is ever executing: JS is run-to-completion, so a
        // second frame on the stack would be the simulator inventing threads.
        expect(step.columns.stack.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('drains nextTick before microtasks before macrotasks', () => {
    const { steps } = traceSnippet(snippetById('ordering'));
    const output = finalOutput({ steps });

    // '4' is nextTick, '3' is a promise, '2' is a timer — all queued in the
    // opposite order to the one they run in.
    expect(output.indexOf('4')).toBeLessThan(output.indexOf('3'));
    expect(output.indexOf('3')).toBeLessThan(output.indexOf('2'));
    // And both synchronous logs precede all three.
    expect(output.indexOf('5')).toBeLessThan(output.indexOf('4'));
  });

  it('lets a microtask chain refill the queue it is being drained from', () => {
    const { steps } = traceSnippet(snippetById('starvation'));
    const micro = columns(steps, 'micro');

    // If microtasks were one-per-turn, the queue would drain monotonically.
    // It does not: it goes back up, which is exactly the starvation mechanism.
    const refilled = micro.some((length, i) => i > 0 && length > micro[i - 1]!);
    expect(refilled).toBe(true);

    // The timer was queued first and still finishes last.
    expect(finalOutput({ steps }).at(-1)).toBe('timer');
  });

  it('holds a due timer for the whole time the stack is blocked', () => {
    const { steps } = traceSnippet(snippetById('blocking'));

    const blockedAt = steps.findIndex((step) => (step.counters?.blockedMs ?? 0) > 0);
    const timerRanAt = steps.findIndex((step) =>
      step.output.includes('timer wanted 0 ms'),
    );
    expect(blockedAt).toBeGreaterThan(-1);
    expect(timerRanAt).toBeGreaterThan(blockedAt);

    // From the moment the block starts until the stack finally empties, the
    // timer is sitting in the macro queue: due, ready, and unable to run.
    // That is the entire failure mode, asserted rather than narrated.
    const window = steps.slice(blockedAt, timerRanAt);
    const running = (step: EventLoopStep) =>
      step.columns.stack.some((cell) => cell.value === 'timer');

    expect(window.length).toBeGreaterThan(0);
    for (const step of window) {
      // The timer is never lost — it is queued the whole time, and only leaves
      // the queue by being picked up onto the stack.
      expect(step.columns.macro.length + (running(step) ? 1 : 0)).toBe(1);
    }
    // And for most of that window it is *waiting*, not running: the block holds
    // the stack, so a 0 ms timer does not get to fire for 200 ms.
    expect(window.filter((step) => !running(step)).length).toBeGreaterThan(1);
    expect(finalOutput({ steps })).toEqual(['sync work done', 'timer wanted 0 ms']);
  });

  it('ends with every queue empty', () => {
    for (const snippet of SNIPPETS) {
      const last = traceSnippet(snippet).steps.at(-1)!;
      expect(last.columns.stack).toHaveLength(0);
      expect(last.columns.nextTick).toHaveLength(0);
      expect(last.columns.micro).toHaveLength(0);
      expect(last.columns.macro).toHaveLength(0);
    }
  });

  it('gives every queued job a stable, unique id', () => {
    for (const snippet of SNIPPETS) {
      for (const step of traceSnippet(snippet).steps) {
        const ids = Object.values(step.columns).flatMap((cells) =>
          cells.map((c) => c.id),
        );
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
