/**
 * The agent loop: think → act → observe, as an inspectable trace.
 *
 * Honesty constraint, same as elsewhere in this section: nothing here calls a
 * model. So rather than faking model output, this simulates **scripted
 * scenarios** — each one a fixed sequence of decisions that a model might
 * plausibly make — and runs the real loop machinery around them: the context
 * growing, the token budget being consumed, the step limit, the stop condition,
 * and the failure detectors.
 *
 * That split is deliberate and is what keeps it honest. The part that is
 * invented (what the model decides) is clearly labelled as a script. The parts
 * that are *engineering* — how context grows, when a loop is detected, what
 * happens when the budget runs out — are real, and they are what the page is
 * actually teaching. An agent framework's hard problems are all in the second
 * category.
 */

import type { VizStep } from '../core/types.ts';

export type Outcome =
  'running' | 'answered' | 'step-limit' | 'budget' | 'loop-detected';

export interface ToolCall {
  tool: string;
  args: string;
  /** What the tool returned. Scripted — see the module comment. */
  result: string;
  /** Tokens the result adds to the context. Measured as words × 1.3. */
  tokens: number;
}

export interface Turn {
  /** The model's stated reasoning for this step. Scripted. */
  thought: string;
  /** Absent on the final turn, where the agent answers instead of acting. */
  call?: ToolCall;
  /** Present only on the final turn. */
  answer?: string;
}

export interface Scenario {
  id: string;
  label: string;
  question: string;
  /** What this scenario is built to demonstrate. */
  lesson: string;
  turns: Turn[];
}

const t = (text: string) => Math.max(1, Math.round(text.split(/\s+/).length * 1.3));

/**
 * Four scenarios: one that works, and three that fail in the three ways agents
 * actually fail in production.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'happy',
    label: 'Works — three tools, then answers',
    question: 'Is the checkout service healthy, and did anything deploy today?',
    lesson:
      'The shape you want: each step uses the previous observation, and the agent stops as soon as it can answer.',
    turns: [
      {
        thought: 'I need the current health of the checkout service first.',
        call: {
          tool: 'get_service_health',
          args: '{"service": "checkout"}',
          result: '{"status": "degraded", "error_rate": 0.04, "p99_ms": 2400}',
          tokens: t('status degraded error_rate 0.04 p99_ms 2400'),
        },
      },
      {
        thought: 'Degraded. Check whether a deploy correlates with it.',
        call: {
          tool: 'list_deploys',
          args: '{"service": "checkout", "since": "24h"}',
          result: '[{"sha": "a3f19c", "at": "09:12Z", "author": "priya"}]',
          tokens: t('sha a3f19c at 09:12Z author priya'),
        },
      },
      {
        thought: 'One deploy this morning. Did the error rate move after it?',
        call: {
          tool: 'get_metrics',
          args: '{"service": "checkout", "around": "09:12Z"}',
          result: '{"error_rate_before": 0.001, "error_rate_after": 0.04}',
          tokens: t('error_rate_before 0.001 error_rate_after 0.04'),
        },
      },
      {
        thought: 'Enough to answer. The deploy correlates with a 40× error increase.',
        answer:
          'Checkout is degraded: error rate rose from 0.1% to 4% immediately after deploy a3f19c at 09:12Z.',
      },
    ],
  },

  {
    id: 'loop',
    label: 'Loops — repeats a failing call forever',
    question: 'What is the current on-call rotation?',
    lesson:
      'The most common agent failure. A tool errors, the model re-tries the identical call, and nothing in the loop notices. Without detection this runs until the step limit and bills for every step.',
    turns: [
      {
        thought: 'I should look up the on-call schedule.',
        call: {
          tool: 'get_oncall',
          args: '{"team": "platform"}',
          result: 'Error: 403 Forbidden — token lacks schedule:read',
          tokens: t('Error 403 Forbidden token lacks schedule read'),
        },
      },
      {
        thought: 'That failed. Let me try looking up the on-call schedule.',
        call: {
          tool: 'get_oncall',
          args: '{"team": "platform"}',
          result: 'Error: 403 Forbidden — token lacks schedule:read',
          tokens: t('Error 403 Forbidden token lacks schedule read'),
        },
      },
      {
        thought: 'Still failing. I will retrieve the on-call schedule.',
        call: {
          tool: 'get_oncall',
          args: '{"team": "platform"}',
          result: 'Error: 403 Forbidden — token lacks schedule:read',
          tokens: t('Error 403 Forbidden token lacks schedule read'),
        },
      },
      {
        thought: 'Let me check the on-call schedule.',
        call: {
          tool: 'get_oncall',
          args: '{"team": "platform"}',
          result: 'Error: 403 Forbidden — token lacks schedule:read',
          tokens: t('Error 403 Forbidden token lacks schedule read'),
        },
      },
    ],
  },

  {
    id: 'context',
    label: 'Drowns — one tool returns far too much',
    question: 'Which orders failed payment yesterday?',
    lesson:
      'A tool returning a large raw payload consumes the budget in one step. The fix is in the tool, not the model: return summaries and identifiers, and let the agent ask for detail.',
    turns: [
      {
        thought: 'I will query the orders table for yesterday.',
        call: {
          tool: 'run_query',
          args: '{"sql": "SELECT * FROM orders WHERE created_at > now() - 1 day"}',
          result:
            '[14,203 rows, full record each — term, address, line items, history…]',
          tokens: 41000,
        },
      },
      {
        thought: 'That is a great deal of data. I still need to filter for failures.',
        call: {
          tool: 'run_query',
          args: '{"sql": "SELECT * FROM payments WHERE status = \'failed\'"}',
          result: '[2,891 rows, full payment records…]',
          tokens: 12500,
        },
      },
    ],
  },

  {
    id: 'wander',
    label: 'Wanders — plausible steps, no progress',
    question: 'Why did the nightly export job fail?',
    lesson:
      'Each step is individually reasonable and the sequence goes nowhere. This is why a step limit is a correctness control, not just a cost control — nothing in the loop can tell "making progress" from "still going".',
    turns: [
      {
        thought: 'Let me look at the job configuration.',
        call: {
          tool: 'get_job_config',
          args: '{"job": "nightly-export"}',
          result: '{"schedule": "0 2 * * *", "timeout_s": 3600, "retries": 2}',
          tokens: t('schedule 0 2 timeout_s 3600 retries 2'),
        },
      },
      {
        thought: 'Configuration looks normal. Let me check the schedule history.',
        call: {
          tool: 'get_schedule_history',
          args: '{"job": "nightly-export"}',
          result:
            '[{"at": "02:00Z", "status": "failed"}, {"at": "02:00Z", "status": "ok"}]',
          tokens: t('at 02:00Z status failed at 02:00Z status ok'),
        },
      },
      {
        thought: 'It failed once. Let me check whether the schedule changed recently.',
        call: {
          tool: 'get_job_config',
          args: '{"job": "nightly-export", "version": "previous"}',
          result: '{"schedule": "0 2 * * *", "timeout_s": 3600, "retries": 2}',
          tokens: t('schedule 0 2 timeout_s 3600 retries 2'),
        },
      },
      {
        thought: 'Unchanged. Let me look at the job configuration in more detail.',
        call: {
          tool: 'get_job_config',
          args: '{"job": "nightly-export", "expand": true}',
          result:
            '{"schedule": "0 2 * * *", "timeout_s": 3600, "retries": 2, "owner": "data"}',
          tokens: t('schedule 0 2 timeout_s 3600 retries 2 owner data'),
        },
      },
    ],
  },
];

export interface Limits {
  maxSteps: number;
  /** Total context tokens the agent may accumulate. */
  maxTokens: number;
  /** Stop when the same tool is called with identical args this many times. */
  repeatLimit: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxSteps: 6,
  maxTokens: 8000,
  repeatLimit: 3,
};

/**
 * Extends `VizStep` so `useStepPlayer` accepts it, which also means every step
 * carries its own `caption` — the site-wide convention that a visualisation
 * must be followable as prose with no animation at all.
 */
export interface AgentStep extends VizStep {
  index: number;
  turn: Turn;
  /** Running context size after this step, in tokens. */
  contextTokens: number;
  /** How many times this exact (tool, args) pair has now been seen. */
  repeatCount: number;
  outcome: Outcome;
  /** Human-readable reason the run ended, when it ended here. */
  stopReason?: string;
}

export interface AgentRun {
  steps: AgentStep[];
  outcome: Outcome;
  totalTokens: number;
  /** Tokens billed, counting the whole context re-sent on every step. */
  billedTokens: number;
}

/**
 * Run a scenario against real loop controls.
 *
 * The billing model is the part most worth understanding, and the reason it is
 * computed here rather than described: the entire context is re-sent on every
 * step, so an agent's cost is the *sum of prefix sizes*, not the final context
 * size. Ten steps is not ten times one step — it is closer to the triangular
 * number. That quadratic growth is why step limits are a budget control and not
 * merely a safety net.
 */
export function runAgent(
  scenario: Scenario,
  limits: Limits = DEFAULT_LIMITS,
  basePrompt = 600,
): AgentRun {
  const steps: AgentStep[] = [];
  const seen = new Map<string, number>();

  let contextTokens = basePrompt + t(scenario.question);
  let billedTokens = 0;
  let outcome: Outcome = 'running';

  for (const [index, turn] of scenario.turns.entries()) {
    // Every step re-sends everything accumulated so far.
    billedTokens += contextTokens;

    const key = turn.call ? `${turn.call.tool}:${turn.call.args}` : '';
    const repeatCount = key ? (seen.get(key) ?? 0) + 1 : 0;
    if (key) seen.set(key, repeatCount);

    contextTokens += t(turn.thought) + (turn.call?.tokens ?? 0);

    let stopReason: string | undefined;

    if (turn.answer) {
      outcome = 'answered';
      stopReason = 'the agent had enough to answer';
    } else if (repeatCount >= limits.repeatLimit) {
      outcome = 'loop-detected';
      stopReason = `the same call was made ${repeatCount} times — a loop`;
    } else if (contextTokens > limits.maxTokens) {
      outcome = 'budget';
      stopReason = `context reached ${contextTokens.toLocaleString()} tokens, over the ${limits.maxTokens.toLocaleString()} budget`;
    } else if (index + 1 >= limits.maxSteps) {
      outcome = 'step-limit';
      stopReason = `hit the ${limits.maxSteps}-step limit without answering`;
    }

    const caption = turn.answer
      ? 'The agent has enough to answer, and stops.'
      : `Calls ${turn.call!.tool}, adding ${turn.call!.tokens.toLocaleString()} tokens to the context.`;

    steps.push({
      caption: stopReason ? `${caption} Run ended — ${stopReason}.` : caption,
      index,
      turn,
      contextTokens,
      repeatCount,
      outcome,
      stopReason,
    });
    if (outcome !== 'running') break;
  }

  // A scenario whose script simply ran out without answering is still a
  // failure — the agent stopped without producing anything.
  if (outcome === 'running') {
    outcome = 'step-limit';
    const last = steps.at(-1);
    if (last) {
      last.outcome = outcome;
      last.stopReason = 'the agent ran out of steps without answering';
    }
  }

  return { steps, outcome, totalTokens: contextTokens, billedTokens };
}

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
