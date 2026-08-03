import { useMemo, useState } from 'react';
import {
  ArrayStrip,
  CodePane,
  CounterBar,
  GraphCanvas,
  Legend,
  Scrubber,
  StepControls,
  VizFrame,
  VizRow,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import { SAMPLE_GRAPH, traceGraphTraversal, type Strategy } from '../traces/graph.ts';

/**
 * BFS and DFS on the same graph, stepped by a single shared player.
 *
 * One player, two traces, deliberately: the panes advance in lockstep so the
 * reader compares *states at the same step number* rather than watching two
 * animations drift apart. What they see is that the algorithms are identical
 * except for one line — queue or stack — and that this one line is the entire
 * difference between "expands in rings" and "plunges down a branch".
 */
export function BfsDfsCompare() {
  const [lang, setLang] = useState<Lang>('python');
  const [start, setStart] = useState('A');

  const bfs = useMemo(() => traceGraphTraversal(SAMPLE_GRAPH, start, 'bfs'), [start]);
  const dfs = useMemo(() => traceGraphTraversal(SAMPLE_GRAPH, start, 'dfs'), [start]);

  // One timeline, long enough for whichever trace runs longer; each pane clamps
  // to its own last step, so the shorter one simply finishes and holds.
  const longest = bfs.steps.length >= dfs.steps.length ? bfs.steps : dfs.steps;
  const player = useStepPlayer(longest, { interval: 1000 });

  const at = (trace: typeof bfs) =>
    trace.steps[Math.min(player.index, trace.steps.length - 1)];

  const panes: { strategy: Strategy; label: string; trace: typeof bfs }[] = [
    { strategy: 'bfs', label: 'BFS — frontier is a queue', trace: bfs },
    { strategy: 'dfs', label: 'DFS — frontier is a stack', trace: dfs },
  ];

  return (
    <VizFrame
      title="BFS vs DFS, same graph, same step"
      intro="Identical code except for one line. Watch the frontier strips: one takes from the front, the other from the back."
      caption={`${at(bfs).caption}`}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={longest} />
        </>
      }
    >
      <div className="heap-actions">
        <span className="viz-frame__intro">start from</span>
        {SAMPLE_GRAPH.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className="viz-btn"
            data-selected={node.id === start || undefined}
            aria-pressed={node.id === start}
            onClick={() => setStart(node.id)}
          >
            {node.label}
          </button>
        ))}
      </div>

      <VizRow>
        {panes.map(({ strategy, label, trace }) => {
          const step = at(trace);
          return (
            <div className="compare-pane" key={strategy}>
              <div className="viz-array__label">{label}</div>
              <GraphCanvas
                nodes={step.nodes ?? []}
                edges={step.edges ?? []}
                layout="grid"
              />
              <ArrayStrip
                cells={step.cells ?? []}
                indexLabels={false}
                label={strategy === 'bfs' ? 'queue (out ← front)' : 'stack (out ← top)'}
                idPrefix={`${strategy}-`}
              />
              <CounterBar counters={step.counters} spec={trace.counterSpec} />
            </div>
          );
        })}
      </VizRow>

      <Legend
        roles={['active', 'compare', 'sorted']}
        labels={{
          active: 'being expanded',
          compare: 'in the frontier',
          sorted: 'visited',
        }}
      />

      <VizRow>
        {panes.map(({ strategy, trace }) => (
          <CodePane
            key={strategy}
            code={trace.code!}
            lang={lang}
            onLangChange={setLang}
            highlight={at(trace).codeLine}
            label={strategy}
          />
        ))}
      </VizRow>
    </VizFrame>
  );
}
