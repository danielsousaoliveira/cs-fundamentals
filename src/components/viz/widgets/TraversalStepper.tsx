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
  VizStack,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import { ORDER_LABELS, buildBst, traceTraversal, type Order } from '../traces/tree.ts';

const BALANCED = [50, 30, 70, 20, 40, 60, 80];
const DEGENERATE = [10, 20, 30, 40, 50, 60, 70];

const ORDERS: Order[] = ['inorder', 'preorder', 'postorder', 'levelorder'];

/**
 * One tree, four traversals, and the output building up underneath.
 *
 * Switching order without changing the tree is the point: the nodes and edges
 * stay put, only the emission moment moves. That makes "in-order sorts a BST"
 * something the reader observes rather than memorises.
 *
 * The degenerate-tree toggle is the other half — the same code, the same
 * complexity class, and a structure that has quietly become a linked list.
 */
export function TraversalStepper() {
  const [order, setOrder] = useState<Order>('inorder');
  const [degenerate, setDegenerate] = useState(false);
  const [lang, setLang] = useState<Lang>('python');

  const root = useMemo(
    () => buildBst(degenerate ? DEGENERATE : BALANCED)!,
    [degenerate],
  );
  const trace = useMemo(() => traceTraversal(root, order), [root, order]);

  const player = useStepPlayer(trace.steps, { interval: 850 });
  const step = player.step;

  return (
    <VizFrame
      title="Tree traversals"
      intro="Same tree, same edges, same O(n). Only the moment a node is emitted changes."
      caption={step?.caption}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={trace.steps} />
        </>
      }
    >
      <div className="heap-actions">
        {ORDERS.map((option) => (
          <button
            key={option}
            type="button"
            className="viz-btn"
            data-selected={option === order || undefined}
            aria-pressed={option === order}
            onClick={() => setOrder(option)}
          >
            {option}
          </button>
        ))}
        <label className="growth-plot__toggle">
          <input
            type="checkbox"
            checked={degenerate}
            onChange={(e) => setDegenerate(e.target.checked)}
          />
          <span>insert sorted values</span>
        </label>
      </div>

      <p className="viz-frame__intro">{ORDER_LABELS[order]}</p>

      <VizStack>
        <GraphCanvas
          nodes={step?.nodes ?? []}
          edges={step?.edges ?? []}
          layout="tree"
          label={degenerate ? 'a BST built from sorted input' : 'a balanced BST'}
        />
        <ArrayStrip
          cells={step?.cells ?? []}
          indexLabels={false}
          label="output so far"
          idPrefix="trav-"
        />
      </VizStack>

      <CounterBar counters={step?.counters} spec={trace.counterSpec} />

      {degenerate && (
        <p className="viz-frame__intro">
          Every node has one child. Lookup is now O(n), and the recursion is n frames
          deep instead of log n — the same code, the same tree type, and none of the
          guarantees.
        </p>
      )}

      <Legend
        roles={['active', 'compare', 'sorted']}
        labels={{
          active: 'current node',
          compare: 'on the stack / in the queue',
          sorted: 'emitted',
        }}
      />

      {trace.code && (
        <CodePane
          code={trace.code}
          lang={lang}
          onLangChange={setLang}
          highlight={step?.codeLine}
          label={order}
        />
      )}
    </VizFrame>
  );
}
