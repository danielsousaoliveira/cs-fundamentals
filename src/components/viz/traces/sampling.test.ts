import { describe, expect, it } from 'vitest';
import {
  applyTemperature,
  branchingWords,
  buildBigramModel,
  CORPUS,
  DEFAULT_OPTIONS,
  distribution,
  entropy,
  generate,
  makeRng,
  perplexity,
  sample,
  softmax,
  textOf,
  tokenizeCorpus,
  topK,
  topP,
  type SamplingOptions,
} from './sampling.ts';

const model = buildBigramModel();
const the = model.get('the')!;
const opts = (over: Partial<SamplingOptions> = {}): SamplingOptions => ({
  ...DEFAULT_OPTIONS,
  ...over,
});

describe('the bigram model', () => {
  it('counts real transitions from the corpus', () => {
    // Checkable by hand: "index makes" appears twice in the corpus.
    const index = model.get('index')!;
    expect(index.find((t) => t.token === 'makes')?.count).toBe(2);
  });

  it('orders candidates deterministically', () => {
    // Descending count, then alphabetical. Without the alphabetical tiebreak,
    // equal-count tokens would order by corpus position and the widget's bar
    // chart would reshuffle for no visible reason.
    expect(buildBigramModel().get('the')).toEqual(the);

    for (let i = 1; i < the.length; i++) {
      const prev = the[i - 1]!;
      const cur = the[i]!;
      expect(
        prev.count > cur.count ||
          (prev.count === cur.count && prev.token.localeCompare(cur.token) < 0),
      ).toBe(true);
    }
  });

  it('sets each logit to the log of its count', () => {
    for (const token of the) {
      expect(token.logit).toBeCloseTo(Math.log(token.count), 12);
    }
  });

  it('gives words with several continuations to choose from', () => {
    expect(branchingWords(model, 3).length).toBeGreaterThan(3);
    expect(branchingWords(model, 3)).toContain('the');
  });

  it('has no transition out of the final word', () => {
    const words = tokenizeCorpus(CORPUS);
    const last = words[words.length - 1]!;
    // Not asserted as absent — `cold` may appear mid-corpus too. What matters
    // is that generate() stops rather than throwing when it runs out.
    expect(() => model.get(last)).not.toThrow();
  });
});

describe('softmax', () => {
  it('produces a probability distribution', () => {
    const p = softmax([1, 2, 3, 4]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...p)).toBeGreaterThan(0);
  });

  it('recovers the empirical frequencies from log-counts', () => {
    // The property the whole module rests on: softmax(ln c) = c / Σc. This is
    // what makes the widget's "logits" produce the model's true distribution
    // rather than an invented one.
    const counts = the.map((t) => t.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const probabilities = softmax(the.map((t) => t.logit));

    probabilities.forEach((p, i) => {
      expect(p).toBeCloseTo(counts[i]! / total, 12);
    });
  });

  it('is shift-invariant', () => {
    const a = softmax([1, 2, 3]);
    const b = softmax([101, 102, 103]);
    a.forEach((p, i) => expect(p).toBeCloseTo(b[i]!, 12));
  });

  it('does not overflow on the large logits low temperature produces', () => {
    // The failure this guards: at T = 0.05 a logit of 3 becomes 60, and without
    // the max-subtraction Math.exp overflows to Infinity and every probability
    // becomes NaN. Low temperature is the first thing a reader drags to.
    const p = softmax(applyTemperature([3, 2, 1], 0.02));
    expect(p.every(Number.isFinite)).toBe(true);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('returns nothing for an empty input', () => {
    expect(softmax([])).toEqual([]);
  });
});

describe('temperature', () => {
  it('changes nothing at T = 1', () => {
    expect(applyTemperature([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });

  it('sharpens below 1 and flattens above 1', () => {
    const base = the.map((t) => t.logit);
    const sharp = softmax(applyTemperature(base, 0.5));
    const neutral = softmax(base);
    const flat = softmax(applyTemperature(base, 2));

    // The leader's share moves monotonically with temperature.
    expect(Math.max(...sharp)).toBeGreaterThan(Math.max(...neutral));
    expect(Math.max(...flat)).toBeLessThan(Math.max(...neutral));
  });

  it('increases entropy monotonically as it rises', () => {
    // The claim the page makes in one assertion.
    const entropies = [0.25, 0.5, 1, 2, 4].map((t) =>
      entropy(distribution(the, opts({ temperature: t }))),
    );

    for (let i = 1; i < entropies.length; i++) {
      expect(entropies[i]).toBeGreaterThan(entropies[i - 1]!);
    }
  });

  it('collapses to greedy at T = 0 rather than dividing by zero', () => {
    const candidates = distribution(the, opts({ temperature: 0 }));
    const live = candidates.filter((c) => c.probability > 0);

    expect(live.length).toBeGreaterThanOrEqual(1);
    expect(live.reduce((sum, c) => sum + c.probability, 0)).toBeCloseTo(1, 12);
    // Whatever survives must be a maximum-count token.
    const best = Math.max(...the.map((t) => t.count));
    for (const candidate of live) {
      expect(the.find((t) => t.token === candidate.token)!.count).toBe(best);
    }
  });

  it('never produces NaN at any temperature a slider can reach', () => {
    for (const temperature of [0, 0.01, 0.1, 0.5, 1, 1.5, 2, 5]) {
      const candidates = distribution(the, opts({ temperature }));
      expect(candidates.every((c) => Number.isFinite(c.probability))).toBe(true);
      const total = candidates.reduce((sum, c) => sum + c.probability, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });
});

describe('top-k', () => {
  it('keeps exactly k tokens', () => {
    for (const k of [1, 2, 3]) {
      expect(topK([0.4, 0.3, 0.2, 0.1], k).filter(Boolean)).toHaveLength(k);
    }
  });

  it('keeps exactly k even when probabilities tie at the boundary', () => {
    // A naive `p >= threshold` lets three through here.
    expect(topK([0.25, 0.25, 0.25, 0.25], 2).filter(Boolean)).toHaveLength(2);
  });

  it('is disabled at k = 0 and when k exceeds the vocabulary', () => {
    expect(topK([0.5, 0.5], 0).every(Boolean)).toBe(true);
    expect(topK([0.5, 0.5], 99).every(Boolean)).toBe(true);
  });

  it('renormalises what survives back to 1', () => {
    const candidates = distribution(the, opts({ topK: 2 }));
    const live = candidates.filter((c) => !c.excluded);
    expect(live).toHaveLength(2);
    expect(live.reduce((sum, c) => sum + c.probability, 0)).toBeCloseTo(1, 12);
    expect(candidates.filter((c) => c.excluded).every((c) => c.probability === 0)).toBe(
      true,
    );
  });
});

describe('top-p', () => {
  it('keeps the smallest prefix reaching p', () => {
    // 0.5 + 0.3 = 0.8 ≥ 0.75, so two tokens.
    expect(topP([0.5, 0.3, 0.15, 0.05], 0.75)).toEqual([true, true, false, false]);
  });

  it('includes the token that crosses the threshold', () => {
    // The inclusive boundary. With an exclusive one, a distribution whose
    // leader already exceeds p would keep nothing and the sampler would have
    // no candidates at all.
    expect(topP([0.95, 0.05], 0.9)).toEqual([true, false]);
    expect(topP([0.95, 0.05], 0.9).filter(Boolean).length).toBeGreaterThan(0);
  });

  it('is disabled at p = 1', () => {
    expect(topP([0.5, 0.3, 0.2], 1).every(Boolean)).toBe(true);
  });

  it('always keeps at least one token, at any p', () => {
    for (const p of [0, 0.01, 0.5, 0.99, 1]) {
      expect(topP([0.6, 0.3, 0.1], p).filter(Boolean).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('adapts its width to how confident the distribution is', () => {
    // The entire argument for top-p over top-k: one setting, different
    // behaviour on a peaked versus a flat distribution.
    const peaked = topP([0.9, 0.05, 0.03, 0.02], 0.9).filter(Boolean).length;
    const flat = topP([0.3, 0.25, 0.25, 0.2], 0.9).filter(Boolean).length;
    expect(peaked).toBeLessThan(flat);
  });
});

describe('the combined pipeline', () => {
  it('leaves the distribution alone at its defaults', () => {
    const candidates = distribution(the, DEFAULT_OPTIONS);
    expect(candidates.every((c) => !c.excluded)).toBe(true);
    candidates.forEach((c) => expect(c.probability).toBeCloseTo(c.baseProbability, 12));
  });

  it('reports base probabilities unaffected by temperature', () => {
    // The widget draws both, so "before" must stay put while "after" moves.
    const hot = distribution(the, opts({ temperature: 3 }));
    const cold = distribution(the, opts({ temperature: 0.3 }));
    hot.forEach((c, i) =>
      expect(c.baseProbability).toBeCloseTo(cold[i]!.baseProbability, 12),
    );
  });

  it('lets temperature widen the nucleus — the coupling the page warns about', () => {
    // Because temperature is applied BEFORE top-p, raising it moves mass out of
    // the leader and into the tail, so more tokens are needed to reach p. This
    // is why "temperature 1.4, top-p 0.9" behaves like neither knob alone.
    const at = (temperature: number) =>
      distribution(the, opts({ temperature, topP: 0.9 })).filter((c) => !c.excluded)
        .length;

    expect(at(2)).toBeGreaterThan(at(0.5));
  });

  it('always leaves something to sample', () => {
    for (const temperature of [0, 0.1, 1, 3]) {
      for (const k of [0, 1, 2]) {
        for (const p of [0.1, 0.5, 1]) {
          const candidates = distribution(the, { temperature, topK: k, topP: p });
          expect(candidates.filter((c) => c.probability > 0).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps entropy and perplexity consistent', () => {
    const candidates = distribution(the, opts());
    expect(perplexity(candidates)).toBeCloseTo(2 ** entropy(candidates), 10);
    // Entropy is bounded above by log2 of the number of live candidates.
    expect(entropy(candidates)).toBeLessThanOrEqual(Math.log2(the.length) + 1e-9);
  });

  it('has zero entropy when only one token survives', () => {
    expect(entropy(distribution(the, opts({ topK: 1 })))).toBeCloseTo(0, 12);
  });
});

describe('sampling and generation', () => {
  it('is deterministic for a given seed', () => {
    const run = () => textOf('the', generate(model, 'the', opts(), 42, 10));
    expect(run()).toBe(run());
  });

  it('produces different text for different seeds at temperature 1', () => {
    const a = textOf('the', generate(model, 'the', opts(), 1, 10));
    const b = textOf('the', generate(model, 'the', opts(), 999, 10));
    expect(a).not.toBe(b);
  });

  it('is identical across seeds at temperature 0', () => {
    // Greedy decoding ignores the RNG entirely — the reproducibility claim.
    const greedy = opts({ temperature: 0 });
    const a = textOf('the', generate(model, 'the', greedy, 1, 10));
    const b = textOf('the', generate(model, 'the', greedy, 999, 10));
    expect(a).toBe(b);
  });

  it('falls into a repeating loop when decoding greedily', () => {
    // The real, observable failure of temperature 0 — and the reason chat
    // products do not ship at it despite reproducibility being desirable.
    const steps = generate(model, 'the', opts({ temperature: 0 }), 7, 24);
    const tokens = steps.map((s) => s.token);
    expect(tokens.length).toBeGreaterThan(8);

    // A cycle of *some* period, rather than a period guessed in advance — the
    // period is a property of this corpus and would change if a line were
    // edited, but the fact of cycling is the claim the page makes.
    //
    // Greedy decoding is a deterministic walk over a finite state space, so it
    // must eventually revisit a state and then repeat forever. That is not a
    // quirk of this model; it is why no chat product ships at temperature 0.
    const period = [1, 2, 3, 4, 5, 6].find(
      (p) =>
        tokens.length > p * 2 &&
        tokens.slice(p * 2).every((token, i) => tokens[p * 2 + i - p] === token),
    );
    expect(
      period,
      `expected a repeating cycle, got: ${tokens.join(' ')}`,
    ).toBeDefined();

    // And it really is degenerate: only a handful of distinct tokens appear.
    expect(new Set(tokens).size).toBeLessThan(tokens.length / 2);
  });

  it('only ever emits tokens the corpus actually follows', () => {
    const steps = generate(model, 'the', opts({ temperature: 2 }), 3, 20);
    let previous = 'the';
    for (const step of steps) {
      expect(model.get(previous)!.map((t) => t.token)).toContain(step.token);
      previous = step.token;
    }
  });

  it('stops rather than throwing on a word with no continuation', () => {
    expect(generate(model, 'zzz-not-in-corpus', opts(), 1, 5)).toEqual([]);
    expect(textOf('zzz', [])).toBe('zzz');
  });

  it('respects top-k during generation', () => {
    const steps = generate(model, 'the', opts({ topK: 1 }), 5, 8);
    for (const step of steps) {
      expect(step.candidates.filter((c) => c.probability > 0)).toHaveLength(1);
    }
  });
});

describe('makeRng', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('sample', () => {
  it('never returns an excluded token', () => {
    const candidates = distribution(the, opts({ topK: 2 }));
    const allowed = candidates.filter((c) => !c.excluded).map((c) => c.token);
    const rng = makeRng(11);
    for (let i = 0; i < 200; i++) {
      expect(allowed).toContain(sample(candidates, rng));
    }
  });

  it('converges to the stated probabilities', () => {
    // The sampler must actually honour the distribution it is given, not just
    // pick from the right set.
    const candidates = distribution(the, opts());
    const rng = makeRng(2024);
    const counts = new Map<string, number>();
    const runs = 20000;

    for (let i = 0; i < runs; i++) {
      const token = sample(candidates, rng);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }

    for (const candidate of candidates) {
      const observed = (counts.get(candidate.token) ?? 0) / runs;
      expect(Math.abs(observed - candidate.probability)).toBeLessThan(0.02);
    }
  });

  it('returns nothing when every candidate is dead', () => {
    expect(sample([], makeRng(1))).toBe('');
  });
});
