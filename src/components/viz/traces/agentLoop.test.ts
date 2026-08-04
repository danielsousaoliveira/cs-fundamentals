import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  runAgent,
  scenarioById,
  SCENARIOS,
  type Limits,
} from './agentLoop.ts';

const limits = (over: Partial<Limits> = {}): Limits => ({ ...DEFAULT_LIMITS, ...over });

describe('scenarios', () => {
  it('are all reachable by id', () => {
    for (const scenario of SCENARIOS) {
      expect(scenarioById(scenario.id).id).toBe(scenario.id);
    }
  });

  it('falls back to the first scenario for an unknown id', () => {
    expect(scenarioById('nope').id).toBe(SCENARIOS[0]!.id);
  });

  it('each has a stated lesson and at least one turn', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.lesson.length).toBeGreaterThan(20);
      expect(scenario.turns.length).toBeGreaterThan(0);
    }
  });

  it('gives exactly one answer turn, and only at the end, where present', () => {
    for (const scenario of SCENARIOS) {
      const answers = scenario.turns.filter((turn) => turn.answer);
      expect(answers.length).toBeLessThanOrEqual(1);
      if (answers.length === 1) {
        expect(scenario.turns.at(-1)!.answer).toBeDefined();
      }
    }
  });
});

describe('the happy path', () => {
  const run = runAgent(scenarioById('happy'));

  it('answers', () => {
    expect(run.outcome).toBe('answered');
    expect(run.steps.at(-1)!.turn.answer).toBeDefined();
  });

  it('stops on the answering turn, not later', () => {
    expect(run.steps).toHaveLength(scenarioById('happy').turns.length);
    expect(run.steps.filter((s) => s.outcome !== 'running')).toHaveLength(1);
  });

  it('stays inside the token budget', () => {
    expect(run.totalTokens).toBeLessThan(DEFAULT_LIMITS.maxTokens);
  });

  it('never repeats a call', () => {
    expect(Math.max(...run.steps.map((s) => s.repeatCount))).toBe(1);
  });
});

describe('loop detection', () => {
  it('stops the repeating scenario before its script runs out', () => {
    const run = runAgent(scenarioById('loop'));
    expect(run.outcome).toBe('loop-detected');
    // The script has four identical calls; detection fires on the third.
    expect(run.steps).toHaveLength(3);
    expect(run.steps.at(-1)!.stopReason).toContain('loop');
  });

  it('counts repeats of the identical (tool, args) pair', () => {
    const run = runAgent(scenarioById('loop'), limits({ repeatLimit: 99 }));
    expect(run.steps.map((s) => s.repeatCount)).toEqual([1, 2, 3, 4]);
  });

  it('does not fire on distinct calls to the same tool', () => {
    // `wander` calls get_job_config three times with DIFFERENT args. Detecting
    // on the tool name alone would wrongly flag it — and would break every
    // legitimate agent that queries the same tool repeatedly.
    const run = runAgent(scenarioById('wander'), limits({ maxSteps: 99 }));
    expect(run.outcome).not.toBe('loop-detected');
    expect(Math.max(...run.steps.map((s) => s.repeatCount))).toBe(1);
  });

  it('honours a stricter repeat limit', () => {
    const run = runAgent(scenarioById('loop'), limits({ repeatLimit: 2 }));
    expect(run.outcome).toBe('loop-detected');
    expect(run.steps).toHaveLength(2);
  });
});

describe('budget enforcement', () => {
  it('stops when one oversized tool result blows the budget', () => {
    const run = runAgent(scenarioById('context'));
    expect(run.outcome).toBe('budget');
    // A single 41,000-token result ends the run on the first step.
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]!.stopReason).toContain('budget');
  });

  it('reports the context size that breached it', () => {
    const run = runAgent(scenarioById('context'));
    expect(run.totalTokens).toBeGreaterThan(DEFAULT_LIMITS.maxTokens);
  });

  it('lets the run continue with a larger budget', () => {
    const run = runAgent(scenarioById('context'), limits({ maxTokens: 100_000 }));
    expect(run.outcome).not.toBe('budget');
    expect(run.steps.length).toBeGreaterThan(1);
  });
});

describe('the step limit', () => {
  it('stops a wandering agent that never answers', () => {
    const run = runAgent(scenarioById('wander'), limits({ maxSteps: 3 }));
    expect(run.outcome).toBe('step-limit');
    expect(run.steps).toHaveLength(3);
  });

  it('reports a failure when the script ends without an answer', () => {
    // Generous limits, so nothing else fires — the run simply produces nothing.
    const run = runAgent(
      scenarioById('wander'),
      limits({ maxSteps: 99, maxTokens: 1_000_000, repeatLimit: 99 }),
    );
    expect(run.outcome).toBe('step-limit');
    expect(run.steps.at(-1)!.stopReason).toContain('without answering');
  });

  it('never exceeds maxSteps for any scenario or limit', () => {
    for (const scenario of SCENARIOS) {
      for (const maxSteps of [1, 2, 3, 6, 20]) {
        const run = runAgent(scenario, limits({ maxSteps }));
        expect(run.steps.length).toBeLessThanOrEqual(Math.max(maxSteps, 1));
      }
    }
  });
});

describe('cost accounting', () => {
  it('grows context monotonically', () => {
    for (const scenario of SCENARIOS) {
      const run = runAgent(scenario, limits({ maxTokens: 1_000_000, repeatLimit: 99 }));
      const sizes = run.steps.map((s) => s.contextTokens);
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
      }
    }
  });

  it('bills more than the final context, because every step re-sends it', () => {
    // The claim the page makes about agent cost. A single-step run bills roughly
    // its prompt; a multi-step run bills the sum of prefixes.
    const run = runAgent(scenarioById('happy'));
    expect(run.billedTokens).toBeGreaterThan(run.totalTokens);
  });

  it('grows billing super-linearly in the number of steps', () => {
    // Ten steps is not ten times one step — it is closer to the triangular
    // number, because the context re-sent on step n includes everything from
    // steps 1..n-1. This is why a step limit is a budget control.
    const short = runAgent(scenarioById('happy'), limits({ maxSteps: 2 }));
    const long = runAgent(scenarioById('happy'), limits({ maxSteps: 4 }));

    const stepRatio = long.steps.length / short.steps.length;
    const costRatio = long.billedTokens / short.billedTokens;
    expect(costRatio).toBeGreaterThan(stepRatio);
  });

  it('bills nothing beyond the step where it stopped', () => {
    const capped = runAgent(scenarioById('loop'), limits({ repeatLimit: 2 }));
    const uncapped = runAgent(scenarioById('loop'), limits({ repeatLimit: 99 }));
    expect(capped.billedTokens).toBeLessThan(uncapped.billedTokens);
  });
});

describe('invariants across every scenario and limit', () => {
  it('always terminates with a non-running outcome', () => {
    for (const scenario of SCENARIOS) {
      for (const maxSteps of [1, 3, 10]) {
        for (const maxTokens of [1000, 8000, 500_000]) {
          const run = runAgent(scenario, limits({ maxSteps, maxTokens }));
          expect(run.outcome).not.toBe('running');
          expect(run.steps.length).toBeGreaterThan(0);
          // Exactly one terminal step, and it is the last.
          const terminal = run.steps.filter((s) => s.outcome !== 'running');
          expect(terminal).toHaveLength(1);
          expect(terminal[0]).toBe(run.steps.at(-1));
        }
      }
    }
  });

  it('gives a stop reason whenever it stops', () => {
    for (const scenario of SCENARIOS) {
      const run = runAgent(scenario);
      expect(run.steps.at(-1)!.stopReason).toBeTruthy();
    }
  });
});
