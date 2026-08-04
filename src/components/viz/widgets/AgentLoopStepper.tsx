import { useMemo, useState } from 'react';
import { StepControls, VizFrame, useStepPlayer } from '../core/index.ts';
import {
  DEFAULT_LIMITS,
  runAgent,
  SCENARIOS,
  scenarioById,
  type Outcome,
} from '../traces/agentLoop.ts';

/**
 * The agents page's centrepiece.
 *
 * Three things it makes concrete that prose does not:
 *
 * 1. **The context grows with every step**, and the counter shows it. An agent
 *    is not n independent calls; it is one conversation that gets longer.
 * 2. **Cost grows faster than step count**, because the whole context is
 *    re-sent each step. The billed figure is the sum of prefixes, so doubling
 *    the steps more than doubles the bill — visible in the readout.
 * 3. **Loops are obvious to a reader and invisible to the agent.** Stepping
 *    through the `loop` scenario, a human sees the repetition immediately;
 *    nothing inside the loop does, until an explicit detector fires.
 *
 * The scripted parts (what the model decides) are labelled as such in the UI.
 * The loop controls — step limit, token budget, repeat detection, billing — are
 * real, and they are the part worth learning.
 */

const OUTCOME_LABEL: Record<Outcome, string> = {
  running: 'running',
  answered: 'answered',
  'step-limit': 'stopped: step limit',
  budget: 'stopped: token budget',
  'loop-detected': 'stopped: loop detected',
};

export function AgentLoopStepper() {
  const [id, setId] = useState(SCENARIOS[0]!.id);
  const [maxSteps, setMaxSteps] = useState(DEFAULT_LIMITS.maxSteps);
  const [detectLoops, setDetectLoops] = useState(true);

  const scenario = scenarioById(id);

  const run = useMemo(
    () =>
      runAgent(scenario, {
        maxSteps,
        maxTokens: DEFAULT_LIMITS.maxTokens,
        // Turning detection "off" means setting the threshold beyond reach,
        // which is exactly what a system without a detector looks like.
        repeatLimit: detectLoops ? DEFAULT_LIMITS.repeatLimit : 999,
      }),
    [scenario, maxSteps, detectLoops],
  );

  const player = useStepPlayer(run.steps);
  const step = player.step;
  const visible = run.steps.slice(0, player.index + 1);

  return (
    <VizFrame
      title="Stepping the agent loop"
      intro="Think → act → observe, with real loop controls. What the model decides is scripted; the budget, the limits and the loop detection are real."
      caption={
        step?.stopReason
          ? `Run ended — ${step.stopReason}.`
          : `Step ${player.index + 1} of ${run.steps.length}: ${step?.turn.call ? `calling ${step.turn.call.tool}` : 'answering'}.`
      }
      footer={<StepControls player={player} />}
    >
      <div className="agent__controls">
        <label>
          <span>scenario</span>
          <select
            className="viz-select"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>
            step limit <strong>{maxSteps}</strong>
          </span>
          <input
            type="range"
            min={1}
            max={8}
            value={maxSteps}
            onChange={(e) => setMaxSteps(Number(e.target.value))}
          />
        </label>

        <label className="agent__toggle">
          <input
            type="checkbox"
            checked={detectLoops}
            onChange={(e) => setDetectLoops(e.target.checked)}
          />
          <span>detect repeated calls</span>
        </label>
      </div>

      <p className="agent__question">
        <span>question</span> {scenario.question}
      </p>

      <ol className="agent__turns">
        {visible.map((s) => (
          <li
            key={s.index}
            className={`agent__turn${s.index === player.index ? ' agent__turn--current' : ''}${
              s.repeatCount > 1 ? ' agent__turn--repeat' : ''
            }`}
          >
            <span className="agent__phase">think</span>
            <p className="agent__thought">{s.turn.thought}</p>

            {s.turn.call && (
              <>
                <span className="agent__phase">act</span>
                <p className="agent__call">
                  <code>
                    {s.turn.call.tool}({s.turn.call.args})
                  </code>
                  {s.repeatCount > 1 && (
                    <em className="agent__repeat">seen {s.repeatCount}×</em>
                  )}
                </p>

                <span className="agent__phase">observe</span>
                <p className="agent__result">
                  {s.turn.call.result}
                  <em className="agent__tokens">
                    +{s.turn.call.tokens.toLocaleString()} tokens
                  </em>
                </p>
              </>
            )}

            {s.turn.answer && (
              <>
                <span className="agent__phase agent__phase--answer">answer</span>
                <p className="agent__answer">{s.turn.answer}</p>
              </>
            )}
          </li>
        ))}
      </ol>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>context</dt>
          <dd>
            <span className="viz-counters__value">
              {(step?.contextTokens ?? 0).toLocaleString()}
            </span>
            <span className="viz-counters__expected">
              {' '}
              / {DEFAULT_LIMITS.maxTokens.toLocaleString()} tokens
            </span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>billed so far</dt>
          <dd>
            <span className="viz-counters__value">
              {run.steps
                .slice(0, player.index + 1)
                .reduce(
                  (sum, _step, i) =>
                    sum + (i === 0 ? 0 : run.steps[i - 1]!.contextTokens),
                  0,
                )
                .toLocaleString()}
            </span>
            <span className="viz-counters__expected">
              {' '}
              tokens — context re-sent each step
            </span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>outcome</dt>
          <dd>
            <span className="viz-counters__value">{OUTCOME_LABEL[run.outcome]}</span>
          </dd>
        </div>
      </dl>

      <p className="agent__lesson">{scenario.lesson}</p>
    </VizFrame>
  );
}
