import { useState } from 'react';
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
  VizStack,
  useStepPlayer,
  type CellState,
  type VizRole,
  type VizStep,
} from './core/index.ts';

/**
 * Every primitive, in every role, on one page.
 *
 * This is the thing that keeps the library coherent. A shared component library
 * decays the moment two pages need "almost the same" cell and someone forks it;
 * having one route where all the variants sit side by side makes that drift
 * visible immediately, and gives a place to check contrast and reduced-motion
 * behaviour without hunting through content pages.
 */

const ROLES: VizRole[] = [
  'default',
  'active',
  'compare',
  'swap',
  'sorted',
  'ghost',
  'empty',
];

const DEMO_STEPS: VizStep[] = [
  {
    caption: 'Step one — the array is untouched.',
    codeLine: 1,
    counters: { comparisons: 0, swaps: 0 },
    cells: cells([5, 2, 9, 1], {}),
    pointers: [{ label: 'i', target: 'c0' }],
    phase: 'start',
  },
  {
    caption: 'Step two — comparing two elements.',
    codeLine: 2,
    counters: { comparisons: 1, swaps: 0 },
    cells: cells([5, 2, 9, 1], { 0: 'compare', 1: 'compare' }),
    pointers: [
      { label: 'i', target: 'c0' },
      { label: 'j', target: 'c1' },
    ],
  },
  {
    caption: 'Step three — they were out of order, so they swap.',
    codeLine: 3,
    counters: { comparisons: 1, swaps: 1 },
    cells: [
      { id: 'c1', value: 2, index: 0, role: 'swap' },
      { id: 'c0', value: 5, index: 1, role: 'swap' },
      { id: 'c2', value: 9, index: 2 },
      { id: 'c3', value: 1, index: 3 },
    ],
    pointers: [{ label: 'i', target: 'c1' }],
    phase: 'swap',
  },
  {
    caption: 'Step four — the prefix is settled.',
    counters: { comparisons: 1, swaps: 1 },
    cells: [
      { id: 'c1', value: 2, index: 0, role: 'sorted' },
      { id: 'c0', value: 5, index: 1, role: 'sorted' },
      { id: 'c2', value: 9, index: 2 },
      { id: 'c3', value: 1, index: 3 },
    ],
  },
];

function cells(values: number[], roles: Record<number, VizRole>): CellState[] {
  return values.map((value, i) => ({
    id: `c${i}`,
    value,
    index: i,
    role: roles[i],
  }));
}

const DEMO_CODE = {
  python: `for i in range(n):
    if a[i] > a[i + 1]:
        a[i], a[i + 1] = a[i + 1], a[i]`,
  typescript: `for (let i = 0; i < n; i++)
  if (a[i] > a[i + 1])
    [a[i], a[i + 1]] = [a[i + 1], a[i]];`,
};

export function Gallery() {
  const player = useStepPlayer(DEMO_STEPS, { interval: 1100 });
  const [lang, setLang] = useState<'python' | 'typescript'>('python');
  const [hovered, setHovered] = useState<string | null>(null);
  const step = player.step;

  return (
    <>
      <VizFrame
        title="Cell — every role"
        intro="Roles form a lightness ladder and each carries a distinct border weight, so meaning survives greyscale and colour-blindness."
      >
        <ArrayStrip
          cells={ROLES.map((role, i) => ({
            id: `role-${role}`,
            value: role === 'empty' ? '' : i,
            index: i,
            role,
            annotation: role,
          }))}
          indexLabels={false}
        />
        <Legend roles={ROLES} labels={{ default: 'untouched', empty: 'empty slot' }} />
      </VizFrame>

      <VizFrame
        title="ArrayStrip — memoryMode"
        intro="The same primitive drawn as one contiguous block with byte addresses, for the arrays page."
      >
        <ArrayStrip
          cells={cells([3, 1, 4, 1, 5, 9], {})}
          memoryMode
          stride={8}
          label="int64[6] at 0x1000"
        />
      </VizFrame>

      <VizFrame
        title="GraphCanvas — three layouts"
        intro="Tidy tree, circular, and grid. Node positions animate, so a rotation is followable."
      >
        <VizRow>
          <GraphCanvas
            layout="tree"
            label="tree"
            nodes={[1, 2, 3, 4, 5, 6, 7].map((v, i) => ({
              id: `t${i}`,
              value: v,
              role: i === 0 ? 'active' : i > 2 ? 'sorted' : undefined,
            }))}
            edges={[
              { from: 't0', to: 't1' },
              { from: 't0', to: 't2' },
              { from: 't1', to: 't3' },
              { from: 't1', to: 't4' },
              { from: 't2', to: 't5' },
              { from: 't2', to: 't6' },
            ]}
            hoveredId={hovered}
            onHoverNode={setHovered}
            indexOf={(id) => Number(id.slice(1))}
          />
          <GraphCanvas
            layout="circle"
            label="circle"
            nodes={['A', 'B', 'C', 'D', 'E'].map((v, i) => ({
              id: `g${i}`,
              value: v,
              role: i === 2 ? 'compare' : undefined,
            }))}
            edges={[
              { from: 'g0', to: 'g1', role: 'active' },
              { from: 'g1', to: 'g2' },
              { from: 'g2', to: 'g3' },
              { from: 'g3', to: 'g0', role: 'ghost' },
              { from: 'g0', to: 'g4' },
            ]}
          />
        </VizRow>
      </VizFrame>

      <VizFrame
        title="Player — controls, scrubber, counters, code sync"
        caption={step?.caption}
        intro="Everything below is driven by one useStepPlayer. Arrow keys step, space plays, when focus is inside the widget."
        footer={
          <>
            <StepControls player={player} />
            <Scrubber player={player} steps={DEMO_STEPS} />
          </>
        }
      >
        <VizStack>
          <ArrayStrip
            cells={step?.cells ?? []}
            pointers={step?.pointers}
            idPrefix="gallery-"
          />
          <CounterBar
            counters={step?.counters}
            spec={[
              {
                key: 'comparisons',
                label: 'comparisons',
                expected: { label: 'n log₂n', value: 4 * Math.log2(4) },
              },
              { key: 'swaps', label: 'swaps' },
            ]}
          />
          <CodePane
            code={DEMO_CODE}
            lang={lang}
            onLangChange={setLang}
            highlight={step?.codeLine}
            label="in sync with the step"
          />
        </VizStack>
      </VizFrame>

      <VizFrame
        title="ArrayStrip — vertical"
        intro="Rotated for stack-shaped data: the call stack and task queues on the event-loop page."
      >
        <VizRow>
          <ArrayStrip
            vertical
            indexLabels={false}
            label="call stack"
            idPrefix="stack-"
            cells={cells(['main()', 'foo()', 'bar()'] as unknown as number[], {
              2: 'active',
            })}
          />
          <ArrayStrip
            vertical
            indexLabels={false}
            label="microtasks"
            idPrefix="micro-"
            cells={cells(['p.then'] as unknown as number[], {})}
          />
          <ArrayStrip
            vertical
            indexLabels={false}
            label="macrotasks"
            idPrefix="macro-"
            cells={[]}
          />
        </VizRow>
      </VizFrame>
    </>
  );
}
