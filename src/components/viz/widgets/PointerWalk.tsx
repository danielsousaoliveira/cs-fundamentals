import { useState } from 'react';
import {
  CodePane,
  CounterBar,
  GraphCanvas,
  Legend,
  Scrubber,
  StepControls,
  VizFrame,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import {
  finalList,
  makeList,
  traceAppend,
  traceDelete,
  traceIdle,
  tracePrepend,
  type ListNode,
} from '../traces/linkedList.ts';
import type { VizTrace } from '../core/types.ts';

const INITIAL = [3, 7, 12, 18];

/**
 * A singly linked list, drawn as what it actually is: nodes with arrows.
 *
 * The widget deliberately puts **prepend** and **append** next to each other,
 * because that pair is the whole lesson. They look symmetric in an API and are
 * nothing alike in cost — one is O(1), the other walks the entire list — and the
 * "pointers followed" counter makes the difference impossible to miss.
 */
export function PointerWalk() {
  const [list, setList] = useState<ListNode[]>(() => makeList(INITIAL));
  const [trace, setTrace] = useState<VizTrace>(() => traceIdle(makeList(INITIAL)));
  const [value, setValue] = useState('5');
  const [lang, setLang] = useState<Lang>('python');

  const player = useStepPlayer(trace.steps, { interval: 1000 });
  const step = player.step;

  function run(next: VizTrace) {
    setTrace(next);
    setList(finalList(next));
  }

  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && value.trim() !== '';

  return (
    <VizFrame
      title="Pointer surgery"
      intro="Watch which `next` gets reassigned, and in what order. The counter is how many pointers had to be followed to get there."
      caption={step?.caption}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={trace.steps} />
        </>
      }
    >
      <div className="heap-actions">
        <label className="heap-actions__field">
          <span className="sr-only">Value</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Value"
          />
        </label>
        <button
          type="button"
          className="viz-btn"
          disabled={!valid}
          onClick={() => run(tracePrepend(list, parsed))}
        >
          prepend — O(1)
        </button>
        <button
          type="button"
          className="viz-btn"
          disabled={!valid}
          onClick={() => run(traceAppend(list, parsed))}
        >
          append — O(n)
        </button>
        <button
          type="button"
          className="viz-btn"
          disabled={!valid || list.length === 0}
          onClick={() => run(traceDelete(list, parsed))}
        >
          delete
        </button>
        <button
          type="button"
          className="viz-btn"
          onClick={() => {
            const fresh = makeList(INITIAL);
            setList(fresh);
            setTrace(traceIdle(fresh));
          }}
        >
          reset
        </button>
      </div>

      <GraphCanvas
        nodes={step?.nodes ?? []}
        edges={step?.edges ?? []}
        layout="chain"
        label="head → … → null"
      />

      <CounterBar counters={step?.counters} spec={trace.counterSpec} />

      <Legend
        roles={['active', 'compare', 'swap', 'sorted', 'ghost']}
        labels={{
          active: 'new or changed node',
          compare: 'visited while searching',
          swap: 'about to be removed',
          sorted: 'settled',
          ghost: 'detached from the list',
        }}
      />

      {trace.code && (
        <CodePane
          code={trace.code}
          lang={lang}
          onLangChange={setLang}
          highlight={step?.codeLine}
          label="the operation running"
        />
      )}
    </VizFrame>
  );
}
