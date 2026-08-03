import { useMemo, useState } from 'react';
import {
  ArrayStrip,
  CodePane,
  CounterBar,
  Legend,
  Scrubber,
  StepControls,
  VizFrame,
  VizRow,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import { DEMO_OPS, traceQueue, type QueueKind } from '../traces/queue.ts';

/**
 * The same queue operations against two implementations, on one timeline.
 *
 * Both satisfy FIFO and both expose the same two methods, so nothing at the API
 * level distinguishes them. The only visible difference is the "elements
 * relocated" counter — which stays at zero on one side and climbs quadratically
 * on the other. That counter is the entire argument for `deque` over `list`.
 */
export function QueueCompare() {
  const [lang, setLang] = useState<Lang>('python');

  const shift = useMemo(() => traceQueue('shift', DEMO_OPS), []);
  const ring = useMemo(() => traceQueue('ring', DEMO_OPS), []);

  // Longest timeline drives both; the shorter pane holds on its final frame.
  const longest = shift.steps.length >= ring.steps.length ? shift.steps : ring.steps;
  const player = useStepPlayer(longest, { interval: 950 });

  const at = (trace: typeof shift) =>
    trace.steps[Math.min(player.index, trace.steps.length - 1)]!;

  const panes: { kind: QueueKind; label: string; trace: typeof shift }[] = [
    { kind: 'shift', label: 'list.pop(0) / Array#shift', trace: shift },
    { kind: 'ring', label: 'ring buffer (deque)', trace: ring },
  ];

  return (
    <VizFrame
      title="Two queues, same operations"
      intro="Identical FIFO behaviour, identical API. Watch the 'elements relocated' counters diverge."
      caption={at(shift).caption}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={longest} />
        </>
      }
    >
      <VizRow>
        {panes.map(({ kind, label, trace }) => {
          const step = at(trace);
          return (
            <div className="compare-pane" key={kind}>
              <div className="viz-array__label">{label}</div>
              <ArrayStrip
                cells={step.cells ?? []}
                pointers={step.pointers}
                idPrefix={`${kind}-`}
              />
              <CounterBar counters={step.counters} spec={trace.counterSpec} />
            </div>
          );
        })}
      </VizRow>

      <Legend
        roles={['default', 'active', 'compare', 'swap', 'empty']}
        labels={{
          default: 'holding a value',
          active: 'just enqueued',
          compare: 'about to be shifted down',
          swap: 'being dequeued',
          empty: 'free slot',
        }}
      />

      <VizRow>
        {panes.map(({ kind, trace }) => (
          <CodePane
            key={kind}
            code={trace.code!}
            lang={lang}
            onLangChange={setLang}
            highlight={at(trace).codeLine}
            label={kind === 'shift' ? 'naive' : 'ring buffer'}
          />
        ))}
      </VizRow>
    </VizFrame>
  );
}
