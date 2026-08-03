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
import {
  PRESETS,
  SORT_LABELS,
  makeItems,
  traceSort,
  type PresetName,
  type SortName,
} from '../traces/sort.ts';

/**
 * Two sorting algorithms on one timeline, with the comparison counter running.
 *
 * The counter is the widget. "Bubble sort is O(n²) and merge sort is O(n log n)"
 * is a sentence everyone can recite and few people have felt; watching one side
 * stop at 12 while the other grinds to 28 on the same eight elements is what
 * turns the claim into an observation.
 *
 * The input presets matter as much as the algorithms, because they are what
 * expose the cases the asymptotic notation hides — sorted input is bubble
 * sort's best case and quicksort's worst.
 */
const CHOICES: SortName[] = ['bubble', 'insertion', 'selection', 'merge', 'quick'];

const PRESET_LABELS: Record<PresetName, string> = {
  random: 'random',
  sorted: 'already sorted',
  reversed: 'reversed',
  duplicates: 'many duplicates',
};

export function SortRace() {
  const [left, setLeft] = useState<SortName>('bubble');
  const [right, setRight] = useState<SortName>('merge');
  const [preset, setPreset] = useState<PresetName>('random');
  const [lang, setLang] = useState<Lang>('python');

  const values = PRESETS[preset];

  // Separate item sets per side: the ids drive FLIP animation, and two panes
  // sharing ids would make the renderer animate cells between them.
  const leftTrace = useMemo(
    () => traceSort(left, makeItems([...values], 'l')),
    [left, values],
  );
  const rightTrace = useMemo(
    () => traceSort(right, makeItems([...values], 'r')),
    [right, values],
  );

  // One player for both, driven by whichever trace is longer; the shorter pane
  // holds on its final frame. A shared clock is the only way the comparison is
  // fair — two independent players would just show two different speeds.
  const longest =
    leftTrace.steps.length >= rightTrace.steps.length
      ? leftTrace.steps
      : rightTrace.steps;
  const player = useStepPlayer(longest, { interval: 420 });

  const at = (trace: typeof leftTrace) =>
    trace.steps[Math.min(player.index, trace.steps.length - 1)]!;

  const panes = [
    { side: 'left' as const, name: left, set: setLeft, trace: leftTrace },
    { side: 'right' as const, name: right, set: setRight, trace: rightTrace },
  ];

  const done = (trace: typeof leftTrace) =>
    trace.steps.at(-1)!.counters?.comparisons ?? 0;

  return (
    <VizFrame
      title="Two sorts, same array, one clock"
      intro="Change the input as well as the algorithms — sorted input is bubble sort's best case and quicksort's worst, and no asymptotic notation shows you that."
      caption={at(leftTrace).caption}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={longest} />
        </>
      }
    >
      <div className="heap-actions">
        <span className="viz-array__label">input:</span>
        {(Object.keys(PRESETS) as PresetName[]).map((name) => (
          <button
            key={name}
            type="button"
            className="viz-btn"
            aria-pressed={name === preset}
            onClick={() => {
              setPreset(name);
              player.reset();
            }}
          >
            {PRESET_LABELS[name]}
          </button>
        ))}
      </div>

      <VizRow>
        {panes.map(({ side, name, set, trace }) => {
          const step = at(trace);
          return (
            <div className="compare-pane" key={side}>
              <label className="viz-array__label">
                <span className="sr-only">
                  {side === 'left' ? 'Left' : 'Right'} algorithm
                </span>
                <select
                  className="viz-select"
                  value={name}
                  onChange={(e) => {
                    set(e.target.value as SortName);
                    player.reset();
                  }}
                  aria-label={`${side} algorithm`}
                >
                  {CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {SORT_LABELS[choice]}
                    </option>
                  ))}
                </select>
              </label>

              <ArrayStrip cells={step.cells ?? []} pointers={step.pointers} />
              <CounterBar counters={step.counters} spec={trace.counterSpec} />
            </div>
          );
        })}
      </VizRow>

      {player.index >= longest.length - 1 && (
        <p className="viz-frame__intro">
          Final tally on {PRESET_LABELS[preset]} input: {SORT_LABELS[left]}{' '}
          <strong>{done(leftTrace)}</strong> comparisons, {SORT_LABELS[right]}{' '}
          <strong>{done(rightTrace)}</strong>. With eight elements the gap is small; the
          exponent is what decides it at eight thousand.
        </p>
      )}

      <Legend
        roles={['default', 'compare', 'active', 'swap', 'sorted']}
        labels={{
          default: 'unsorted',
          compare: 'being compared',
          active: 'held / pivot',
          swap: 'just moved',
          sorted: 'in final position',
        }}
      />

      <VizRow>
        {panes.map(({ side, name, trace }) => (
          <CodePane
            key={side}
            code={trace.code!}
            lang={lang}
            onLangChange={setLang}
            highlight={at(trace).codeLine}
            label={SORT_LABELS[name]}
          />
        ))}
      </VizRow>
    </VizFrame>
  );
}
