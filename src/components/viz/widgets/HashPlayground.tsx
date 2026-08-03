import { useMemo, useState } from 'react';
import {
  ArrayStrip,
  Cell,
  CodePane,
  CounterBar,
  Legend,
  Scrubber,
  StepControls,
  VizFrame,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import {
  finalState,
  findCollidingKey,
  traceIdle,
  traceInsert,
  traceLookup,
  type HashState,
  type HashTrace,
} from '../traces/hashTable.ts';

const INITIAL: HashState = {
  capacity: 8,
  entries: [
    { key: 'apple', value: 1 },
    { key: 'banana', value: 2 },
    { key: 'cherry', value: 3 },
  ],
};

/**
 * Type a key, watch it hash into a bucket. Then force a collision on purpose,
 * and keep going until the load factor trips a rehash.
 *
 * The "force a collision" button matters more than it looks: collisions are the
 * thing that makes a hash table's O(1) an *average* rather than a guarantee, and
 * they are almost impossible to encounter by accident while playing. Making them
 * one click away is what connects the animation to the failure mode.
 */
export function HashPlayground() {
  const [state, setState] = useState<HashState>(INITIAL);
  const [trace, setTrace] = useState<HashTrace>(() => traceIdle(INITIAL));
  const [input, setInput] = useState('durian');
  const [lang, setLang] = useState<Lang>('python');

  const player = useStepPlayer(trace.steps, { interval: 1100 });
  const step = player.step;

  const buckets = step?.buckets ?? [];
  const maxChain = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.entries.length)),
    [buckets],
  );

  function run(next: HashTrace, commit = true) {
    setTrace(next);
    if (commit) setState(finalState(next, state));
  }

  const colliding = findCollidingKey(state);

  return (
    <VizFrame
      title="Hash table: buckets, collisions, and the rehash"
      intro="Each row is one bucket. Entries to the right of a bucket are its collision chain."
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
          <span className="sr-only">Key</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Key"
            style={{ width: '7rem' }}
          />
        </label>
        <button
          type="button"
          className="viz-btn"
          disabled={!input.trim()}
          onClick={() =>
            run(traceInsert(state, input.trim(), state.entries.length + 1))
          }
        >
          insert
        </button>
        <button
          type="button"
          className="viz-btn"
          disabled={!input.trim()}
          onClick={() => run(traceLookup(state, input.trim()), false)}
        >
          look up
        </button>
        <button
          type="button"
          className="viz-btn"
          disabled={!colliding}
          onClick={() => colliding && run(traceInsert(state, colliding, 0))}
          title={
            colliding
              ? `"${colliding}" hashes into an already-occupied bucket`
              : 'nothing to collide with yet'
          }
        >
          force a collision
        </button>
        <button
          type="button"
          className="viz-btn"
          onClick={() => {
            setState(INITIAL);
            setTrace(traceIdle(INITIAL));
          }}
        >
          reset
        </button>
      </div>

      <div className="hash-table">
        {buckets.map((bucket) => (
          <div className="hash-table__row" key={bucket.index}>
            <span className="hash-table__index">{bucket.index}</span>
            <Cell
              value={bucket.entries.length === 0 ? '·' : bucket.entries.length}
              role={bucket.role ?? (bucket.entries.length ? 'default' : 'empty')}
            />
            <span className="hash-table__chain">
              {bucket.entries.length > 0 && (
                <ArrayStrip
                  cells={bucket.entries}
                  indexLabels={false}
                  idPrefix={`b${bucket.index}-`}
                />
              )}
            </span>
          </div>
        ))}
      </div>

      <CounterBar counters={step?.counters} spec={trace.counterSpec} />

      {maxChain > 2 && (
        <p className="viz-frame__intro">
          Longest chain is now {maxChain}. A lookup landing there costs {maxChain}{' '}
          comparisons — still called O(1), because the average over all buckets stays
          constant.
        </p>
      )}

      <Legend
        roles={['active', 'compare', 'swap', 'sorted', 'ghost', 'empty']}
        labels={{
          active: 'target bucket',
          compare: 'being compared / rehashed',
          swap: 'moved or replaced',
          sorted: 'match',
          ghost: 'miss',
          empty: 'empty bucket',
        }}
      />

      {trace.code && (
        <CodePane
          code={trace.code}
          lang={lang}
          onLangChange={setLang}
          highlight={step?.codeLine}
          label="insert"
        />
      )}
    </VizFrame>
  );
}
