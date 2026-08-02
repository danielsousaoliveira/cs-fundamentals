import { useMemo, useState } from 'react';
import { LayoutGroup } from 'motion/react';
import {
  ArrayStrip,
  CodePane,
  CounterBar,
  GraphCanvas,
  Legend,
  Scrubber,
  StepControls,
  VizFrame,
  VizStack,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import {
  finalItems,
  makeItems,
  traceBuildHeap,
  traceExtractMin,
  traceIdle,
  traceInsert,
  type HeapItem,
} from '../traces/heap.ts';

const INITIAL = [1, 3, 6, 5, 9, 8];

interface HeapExplorerProps {
  /** Starting values. Defaults to a small valid min-heap. */
  initial?: number[];
  defaultLang?: Lang;
}

/**
 * The heap page's centrepiece: one heap, drawn simultaneously as a tree and as
 * the flat array that actually holds it.
 *
 * Both views share element ids, and both live inside a single `<LayoutGroup>`,
 * so a swap animates in both at once — the tree nodes exchange places while the
 * array cells slide past each other. That simultaneity is the entire argument
 * the widget exists to make: these are not two data structures, they are one
 * block of memory and two ways of reading it.
 */
export function HeapExplorer({
  initial = INITIAL,
  defaultLang = 'python',
}: HeapExplorerProps) {
  const [items, setItems] = useState<HeapItem[]>(() => makeItems(initial));
  const [trace, setTrace] = useState(() => traceIdle(makeItems(initial)));
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [hovered, setHovered] = useState<string | null>(null);
  const [nextValue, setNextValue] = useState('4');

  const player = useStepPlayer(trace.steps, { interval: 950 });
  const step = player.step;

  // Index lookup for the tree's `[i]` labels — the bridge between the two views.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    (step?.cells ?? []).forEach((cell) => map.set(cell.id, cell.index));
    return map;
  }, [step]);

  function run(next: ReturnType<typeof traceIdle>) {
    setTrace(next);
    // Commit the end state now; the animation is a replay of how we got there.
    setItems(finalItems(next));
  }

  const parsed = Number(nextValue);
  const canInsert = Number.isFinite(parsed) && nextValue.trim() !== '';

  return (
    <VizFrame
      title="Heap ⇄ array"
      intro="The same heap, drawn twice. Hover either view to light up the other."
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
          <span className="sr-only">Value to insert</span>
          <input
            type="number"
            value={nextValue}
            onChange={(e) => setNextValue(e.target.value)}
            aria-label="Value to insert"
          />
        </label>
        <button
          type="button"
          className="viz-btn"
          disabled={!canInsert}
          onClick={() => run(traceInsert(items, parsed))}
        >
          insert
        </button>
        <button
          type="button"
          className="viz-btn"
          disabled={items.length === 0}
          onClick={() => run(traceExtractMin(items))}
        >
          extract min
        </button>
        <button
          type="button"
          className="viz-btn"
          onClick={() => run(traceBuildHeap(makeItems(shuffled(15))))}
        >
          build heap from 15 random values
        </button>
        <button
          type="button"
          className="viz-btn"
          onClick={() => {
            const fresh = makeItems(initial);
            setItems(fresh);
            setTrace(traceIdle(fresh));
          }}
        >
          reset
        </button>
      </div>

      {/* One LayoutGroup: the tree and the array animate as a single system. */}
      <LayoutGroup id="heap-explorer">
        <VizStack>
          <GraphCanvas
            nodes={step?.nodes ?? []}
            edges={step?.edges ?? []}
            layout="tree"
            label="as a binary tree"
            hoveredId={hovered}
            onHoverNode={setHovered}
            indexOf={(id) => indexById.get(id)}
          />
          <ArrayStrip
            cells={step?.cells ?? []}
            pointers={step?.pointers}
            label="as it is actually stored — one flat array"
            idPrefix="heap-"
            hoveredId={hovered}
            onHoverCell={setHovered}
          />
        </VizStack>
      </LayoutGroup>

      <CounterBar counters={step?.counters} spec={trace.counterSpec} />

      <Legend
        roles={['active', 'compare', 'swap', 'sorted', 'ghost']}
        labels={{ sorted: 'settled — heap property holds', ghost: 'removed' }}
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

/** A shuffled 1..n, so "build heap" starts from something genuinely unordered. */
function shuffled(n: number): number[] {
  const values = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j]!, values[i]!];
  }
  return values;
}
