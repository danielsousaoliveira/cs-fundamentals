import { useMemo, useState } from 'react';
import {
  ArrayStrip,
  CodePane,
  CounterBar,
  Scrubber,
  StepControls,
  VizFrame,
  useStepPlayer,
  type Lang,
} from '../core/index.ts';
import {
  QUEUE_LABELS,
  SNIPPETS,
  traceSnippet,
  type EventLoopStep,
} from '../traces/eventLoop.ts';

/**
 * The call stack and the three queues, side by side, on one timeline.
 *
 * The reason this widget exists rather than a paragraph: the queues are real
 * data structures that a debugger will not show you. A reader who has been told
 * "`setTimeout(fn, 0)` runs later" still cannot predict `1 5 4 3 2` — but a
 * reader who has watched the callback sit in the rightmost column while two
 * other columns drain in front of it can predict it, and can predict the next
 * one too.
 */
const COLUMNS = ['stack', 'nextTick', 'micro', 'macro'] as const;

export function EventLoopSim() {
  const [id, setId] = useState(SNIPPETS[0]!.id);
  const [lang, setLang] = useState<Lang>('typescript');

  const snippet = SNIPPETS.find((s) => s.id === id)!;
  const trace = useMemo(() => traceSnippet(snippet), [snippet]);
  const player = useStepPlayer<EventLoopStep>(trace.steps, { interval: 1300 });
  const step = player.step;

  return (
    <VizFrame
      title="The event loop, one job at a time"
      intro={snippet.lesson}
      caption={step?.caption}
      footer={
        <>
          <StepControls player={player} />
          <Scrubber player={player} steps={trace.steps} />
        </>
      }
    >
      <div className="heap-actions">
        {SNIPPETS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="viz-btn"
            aria-pressed={option.id === id}
            onClick={() => setId(option.id)}
          >
            {option.title.replace(/`/g, '')}
          </button>
        ))}
      </div>

      <div className="loop-columns">
        {COLUMNS.map((column) => (
          <div className="loop-column" key={column}>
            <div className="viz-array__label">{QUEUE_LABELS[column]}</div>
            <div className="loop-column__body">
              {step && step.columns[column].length > 0 ? (
                <ArrayStrip
                  cells={step.columns[column]}
                  indexLabels={false}
                  idPrefix={`${column}-`}
                />
              ) : (
                <span className="loop-column__empty">empty</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="loop-output">
        <div className="viz-array__label">stdout</div>
        <pre className="loop-output__pre">
          {step?.output.length ? step.output.join('\n') : '(nothing yet)'}
        </pre>
      </div>

      {snippet.caveat && <p className="viz-frame__intro">{snippet.caveat}</p>}

      {trace.counterSpec && trace.counterSpec.length > 0 && (
        <CounterBar counters={step?.counters} spec={trace.counterSpec} />
      )}

      <CodePane
        code={trace.code!}
        lang={lang}
        onLangChange={setLang}
        highlight={step?.codeLine}
        label="snippet"
      />
    </VizFrame>
  );
}
