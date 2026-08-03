import type { CellState, VizStep, VizTrace } from '../core/types.ts';

/**
 * The event loop, as a trace.
 *
 * Every other widget on this site animates a data structure. This one animates a
 * *scheduler*, because the thing readers get wrong about `setTimeout(fn, 0)` is
 * not what it does — it is **which queue it lands in and when that queue is
 * drained**. Those queues are invisible in a debugger, so drawing them is the
 * whole lesson.
 *
 * Deliberately NOT a JavaScript interpreter. Parsing arbitrary user code to
 * simulate it faithfully is a large, fragile project whose failure mode is the
 * worst one available to a teaching site: a visualisation that confidently shows
 * the wrong answer. Instead each snippet is hand-authored as an explicit list of
 * jobs and effects, and a test asserts the simulated output matches the output
 * the real runtime produces — each snippet's `expected` array was recorded by
 * running the code in Node 24, not from memory.
 */

/** The queues, in the order the loop drains them. */
export type QueueName = 'nextTick' | 'micro' | 'macro';

export const QUEUE_LABELS: Record<QueueName | 'stack', string> = {
  stack: 'call stack',
  nextTick: 'process.nextTick',
  micro: 'microtasks (promises)',
  macro: 'macrotasks (timers, I/O)',
};

export interface JobSpec {
  /** Short name shown in the queue cell. */
  label: string;
  /** 1-indexed line in the snippet this job comes from. */
  codeLine: number;
  effects: Effect[];
}

export type Effect =
  /** Synchronous output. */
  | { kind: 'log'; text: string }
  /** Occupy the thread for a while without yielding — the blocking case. */
  | { kind: 'block'; ms: number; note: string }
  /** Put a job on a queue. */
  | { kind: 'schedule'; queue: QueueName; job: JobSpec; note?: string };

export interface EventLoopStep extends VizStep {
  /** One column per queue, plus the stack. */
  columns: Record<'stack' | QueueName, CellState[]>;
  output: string[];
}

/**
 * Declared as its own interface rather than `VizTrace & { steps: … }`. An
 * intersection keeps both `steps` members, so element access resolves back to
 * the base `VizStep` and every consumer loses the extra fields.
 */
export interface EventLoopTrace extends Omit<VizTrace, 'steps'> {
  steps: EventLoopStep[];
}

interface Queued {
  id: string;
  job: JobSpec;
}

const PRIORITY: QueueName[] = ['nextTick', 'micro', 'macro'];

function cells(items: Queued[], active?: string): CellState[] {
  return items.map((item, index) => ({
    id: item.id,
    value: item.job.label,
    index,
    role: item.id === active ? 'active' : index === 0 ? 'compare' : 'default',
  }));
}

/**
 * Run a snippet's job program and record every observable transition.
 *
 * The simulator is deliberately literal about one thing: **the queues are only
 * consulted when the stack is empty**. That single rule is what produces every
 * surprising ordering in the snippets below, so it is expressed as a loop
 * condition rather than buried in a comment.
 */
export function traceSnippet(snippet: Snippet): EventLoopTrace {
  const queues: Record<QueueName, Queued[]> = { nextTick: [], micro: [], macro: [] };
  const stack: Queued[] = [];
  const output: string[] = [];
  const steps: EventLoopStep[] = [];
  let counter = 0;
  let blockedMs = 0;

  const frame = (
    caption: string,
    codeLine: number | undefined,
    active?: string,
    phase?: string,
  ) => {
    steps.push({
      caption,
      codeLine,
      phase,
      counters: { blockedMs },
      columns: {
        stack: cells(stack, active),
        nextTick: cells(queues.nextTick),
        micro: cells(queues.micro),
        macro: cells(queues.macro),
      },
      output: [...output],
    });
  };

  const enqueue = (queue: QueueName, job: JobSpec): Queued => {
    const entry = { id: `j${counter++}`, job };
    queues[queue].push(entry);
    return entry;
  };

  const main: Queued = { id: `j${counter++}`, job: snippet.main };
  frame(
    'Nothing has run yet. All three queues are empty, and the stack is about to receive the top-level script.',
    1,
    undefined,
    'start',
  );

  /** Run one job to completion, emitting a frame per effect. */
  const runJob = (entry: Queued, origin: string) => {
    stack.push(entry);
    frame(
      `${origin} Its body now runs to completion — nothing else on this thread can interleave with it.`,
      entry.job.codeLine,
      entry.id,
    );

    for (const effect of entry.job.effects) {
      if (effect.kind === 'log') {
        output.push(effect.text);
        frame(
          `Prints \`${effect.text}\`. Synchronous, so it happens immediately — no queue involved.`,
          undefined,
          entry.id,
        );
      } else if (effect.kind === 'block') {
        blockedMs += effect.ms;
        frame(
          `${effect.note} The stack is occupied for ~${effect.ms} ms, and because the queues are only read when the stack is empty, **every** pending callback waits — including timers that were already due.`,
          undefined,
          entry.id,
        );
      } else {
        enqueue(effect.queue, effect.job);
        frame(
          effect.note ??
            `Schedules \`${effect.job.label}\` onto the ${QUEUE_LABELS[effect.queue]} queue. It does not run now; it runs when the loop gets to that queue.`,
          effect.job.codeLine,
          entry.id,
        );
      }
    }

    stack.pop();
    frame(
      `\`${entry.job.label}\` returns and leaves the stack. Only now, with the stack empty, is the loop allowed to look at a queue.`,
      undefined,
      undefined,
    );
  };

  runJob(main, 'The script itself is the first job on the stack.');

  let guard = 0;
  for (;;) {
    if (guard++ > 500) throw new Error('event loop trace did not terminate');

    const next = PRIORITY.map((name) => [name, queues[name][0]] as const).find(
      ([, entry]) => entry !== undefined,
    );
    if (!next) break;

    const [name, entry] = next as [QueueName, Queued];
    queues[name].shift();

    const skipped = PRIORITY.slice(PRIORITY.indexOf(name) + 1).filter(
      (other) => queues[other].length > 0,
    );

    runJob(
      entry,
      `Stack empty. The loop drains **${QUEUE_LABELS[name]}** first${
        skipped.length
          ? `, even though ${skipped.map((s) => QUEUE_LABELS[s]).join(' and ')} ${skipped.length > 1 ? 'have' : 'has'} work waiting`
          : ''
      }, and takes \`${entry.job.label}\`.`,
    );
  }

  frame(
    `Every queue is empty, so the loop has nothing left to do and the process can exit. Final output: \`${output.join(' ')}\`.`,
    undefined,
    undefined,
    'done',
  );

  return {
    steps,
    code: { typescript: snippet.code },
    counterSpec:
      blockedMs > 0 ? [{ key: 'blockedMs', label: 'ms the loop was blocked' }] : [],
  };
}

export interface Snippet {
  id: string;
  title: string;
  /** The one-line reason this snippet exists. */
  lesson: string;
  code: string;
  main: JobSpec;
  /** The output the real runtime produces. Asserted in the tests. */
  expected: string[];
  /** A correction to the folklore answer, shown under the widget. */
  caveat?: string;
}

const log = (text: string): Effect => ({ kind: 'log', text });

/**
 * The curated set. Each one isolates exactly one rule; a snippet that
 * demonstrates two rules at once teaches neither.
 */
export const SNIPPETS: Snippet[] = [
  {
    id: 'ordering',
    title: 'The four-queue ordering',
    lesson:
      'Synchronous code, then nextTick, then promises, then timers — in CommonJS.',
    caveat:
      'This is the canonical answer, and it is only correct in CommonJS. Run the same file as an ES module and Node prints 1 5 3 4 2: module evaluation is itself a promise job, so the microtask checkpoint at the end of it drains the .then before control returns to the nextTick queue. Verified on Node 24. It is a good reminder that "nextTick beats promises" is a statement about a queue, not a law of the language.',
    code: `console.log('1');
setTimeout(() => console.log('2'), 0);
Promise.resolve().then(() => console.log('3'));
process.nextTick(() => console.log('4'));
console.log('5');`,
    expected: ['1', '5', '4', '3', '2'],
    main: {
      label: 'main script',
      codeLine: 1,
      effects: [
        log('1'),
        {
          kind: 'schedule',
          queue: 'macro',
          job: { label: "log('2')", codeLine: 2, effects: [log('2')] },
          note: "`setTimeout(…, 0)` does not mean *now*. It means *put this on the timer queue*, which is the last one the loop drains — so `'2'` is already guaranteed to print last.",
        },
        {
          kind: 'schedule',
          queue: 'micro',
          job: { label: "log('3')", codeLine: 3, effects: [log('3')] },
          note: 'The promise is *already resolved*, so its `.then` callback is queued as a microtask immediately. Already-resolved still never means synchronous.',
        },
        {
          kind: 'schedule',
          queue: 'nextTick',
          job: { label: "log('4')", codeLine: 4, effects: [log('4')] },
          note: '`process.nextTick` is a Node-specific queue that sits *in front of* promises — which is why it prints before `3` despite being written after it.',
        },
        log('5'),
      ],
    },
  },
  {
    id: 'await-split',
    title: '`await` splits a function in half',
    lesson:
      'The body up to the first await runs synchronously; the rest is a microtask.',
    code: `async function f() {
  console.log('A');
  await null;
  console.log('B');
}
f();
console.log('C');`,
    expected: ['A', 'C', 'B'],
    main: {
      label: 'main script',
      codeLine: 6,
      effects: [
        log('A'),
        {
          kind: 'schedule',
          queue: 'micro',
          job: { label: 'rest of f()', codeLine: 4, effects: [log('B')] },
          note: 'Here is the part people miss: calling an `async` function runs it **synchronously** until the first `await`. `await null` then hands the remainder of the body to the microtask queue and returns to the caller — the function is now half-finished, sitting in a queue.',
        },
        log('C'),
      ],
    },
  },
  {
    id: 'starvation',
    title: 'Microtasks starve timers',
    lesson: 'The microtask queue is drained to empty, not one per turn.',
    code: `setTimeout(() => console.log('timer'), 0);
Promise.resolve()
  .then(() => { console.log('micro 1'); })
  .then(() => { console.log('micro 2'); })
  .then(() => { console.log('micro 3'); });`,
    expected: ['micro 1', 'micro 2', 'micro 3', 'timer'],
    main: {
      label: 'main script',
      codeLine: 1,
      effects: [
        {
          kind: 'schedule',
          queue: 'macro',
          job: { label: "log('timer')", codeLine: 1, effects: [log('timer')] },
          note: 'The timer is due immediately and is queued first, before any promise callback exists.',
        },
        {
          kind: 'schedule',
          queue: 'micro',
          job: {
            label: 'micro 1',
            codeLine: 3,
            effects: [
              log('micro 1'),
              {
                kind: 'schedule',
                queue: 'micro',
                job: {
                  label: 'micro 2',
                  codeLine: 4,
                  effects: [
                    log('micro 2'),
                    {
                      kind: 'schedule',
                      queue: 'micro',
                      job: { label: 'micro 3', codeLine: 5, effects: [log('micro 3')] },
                      note: 'And a third. Each `.then` in the chain only queues the next one when it runs, so the queue is refilled from inside itself.',
                    },
                  ],
                },
                note: 'Running the first `.then` queues the second — **onto the same microtask queue the loop is currently draining**. This is the mechanism that lets promises starve a timer.',
              },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'blocking',
    title: 'One synchronous loop blocks everything',
    lesson: 'A due timer cannot fire while the stack is occupied.',
    code: `setTimeout(() => console.log('timer wanted 0 ms'), 0);

const end = Date.now() + 200;
while (Date.now() < end) {}     // pure CPU, no await
console.log('sync work done');`,
    expected: ['sync work done', 'timer wanted 0 ms'],
    main: {
      label: 'main script',
      codeLine: 1,
      effects: [
        {
          kind: 'schedule',
          queue: 'macro',
          job: {
            label: 'timer',
            codeLine: 1,
            effects: [log('timer wanted 0 ms')],
          },
          note: 'A 0 ms timer. It becomes due almost immediately — but *due* and *run* are different things.',
        },
        {
          kind: 'block',
          ms: 200,
          note: 'The busy-wait loop starts.',
        },
        log('sync work done'),
      ],
    },
  },
  {
    id: 'foreach',
    title: '`forEach` does not await',
    lesson: 'An async callback returns a promise, and forEach throws it away.',
    code: `const items = ['a', 'b', 'c'];

items.forEach(async (item) => {
  await save(item);
  console.log(item);
});

console.log('done');`,
    expected: ['done', 'a', 'b', 'c'],
    main: {
      label: 'main script',
      codeLine: 3,
      effects: [
        {
          kind: 'schedule',
          queue: 'micro',
          job: { label: "log('a')", codeLine: 5, effects: [log('a')] },
          note: 'The callback runs synchronously up to its `await`, then suspends and hands the rest back as a promise. `forEach` has no `await` and no return value — it **discards that promise** and moves straight to the next item.',
        },
        {
          kind: 'schedule',
          queue: 'micro',
          job: { label: "log('b')", codeLine: 5, effects: [log('b')] },
          note: 'Same for `b`. Three callbacks are now in flight, none of them finished, and nothing is tracking them.',
        },
        {
          kind: 'schedule',
          queue: 'micro',
          job: { label: "log('c')", codeLine: 5, effects: [log('c')] },
        },
        log('done'),
      ],
    },
  },
];

export function snippetById(id: string): Snippet {
  const found = SNIPPETS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown snippet: ${id}`);
  return found;
}

/** The output a trace produced, for tests and for the widget's summary line. */
export function finalOutput(trace: { steps: EventLoopStep[] }): string[] {
  return trace.steps.at(-1)!.output;
}
