/**
 * Sampling: temperature, top-k, and top-p, over a real probability distribution.
 *
 * The honesty problem, and how this solves it. Nothing here can call a language
 * model, and hand-writing a plausible-looking logit vector would be inventing
 * the very numbers the page asks the reader to reason about. So the
 * distributions come from a **bigram model counted from the corpus below** —
 * every probability on screen is a real frequency from text the reader can go
 * and read.
 *
 * The trick that makes this exact rather than merely analogous: a token's logit
 * is set to `ln(count)`, and softmax of a log-count is the empirical frequency.
 *
 *     softmax(ln c)_i = e^{ln c_i} / Σ e^{ln c_j} = c_i / Σ c_j
 *
 * So the model's "logits" really do produce its true next-token distribution,
 * and applying temperature to them gives `c^(1/T) / Σ c^(1/T)` — which is
 * precisely what temperature does inside a real sampler. The `applyTemperature`,
 * `topK`, `topP` and `sample` functions here are not simplifications of the real
 * thing; on a distribution, they *are* the real thing.
 *
 * What genuinely differs from an LLM is only where the distribution comes from:
 * a bigram model conditions on one previous word, a transformer conditions on
 * the whole context. Everything downstream of the logits — this entire module —
 * is identical. That is the claim the page makes, and it is true.
 */

/**
 * The corpus. Written for this purpose rather than borrowed, so it can be
 * reproduced and quoted freely, and deliberately repetitive: a bigram model
 * needs a word to appear in several contexts before its distribution is
 * interesting rather than deterministic.
 */
export const CORPUS = `
the index makes the query fast but the index makes the write slow
the query planner reads the index when the query has a filter
a query without an index reads every row in the table
the cache makes the read fast but the cache goes stale
a stale cache returns the wrong row and nobody notices
the write goes to the table and the write goes to the index
the planner picks the index when the filter is narrow
the planner picks a scan when the filter is wide
every index costs a write and every write costs time
the table grows and the scan gets slow and the query times out
a narrow filter reads few rows and a wide filter reads every row
the cache hides the slow query until the cache goes cold
`;

export interface Token {
  token: string;
  /** ln(count) — see the module comment for why this is the right logit. */
  logit: number;
  count: number;
}

export type BigramModel = Map<string, Token[]>;

export function tokenizeCorpus(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Count every `word → next word` pair.
 *
 * Sorted by descending count, then alphabetically. The alphabetical tiebreak is
 * load-bearing: `Map` iteration order would otherwise leak corpus order into the
 * ranking, and two tokens with equal counts would swap places depending on
 * where they happened to appear. A widget whose bar chart reorders itself for
 * no visible reason teaches the reader that the order is meaningless.
 */
export function buildBigramModel(text: string = CORPUS): BigramModel {
  const words = tokenizeCorpus(text);
  const counts = new Map<string, Map<string, number>>();

  for (let i = 0; i < words.length - 1; i++) {
    const current = words[i]!;
    const next = words[i + 1]!;
    if (!counts.has(current)) counts.set(current, new Map());
    const row = counts.get(current)!;
    row.set(next, (row.get(next) ?? 0) + 1);
  }

  const model: BigramModel = new Map();
  for (const [word, row] of counts) {
    model.set(
      word,
      [...row.entries()]
        .map(([token, count]) => ({ token, count, logit: Math.log(count) }))
        .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token)),
    );
  }

  return model;
}

/** Words with at least `min` distinct continuations — the interesting ones. */
export function branchingWords(model: BigramModel, min = 3): string[] {
  return [...model.entries()]
    .filter(([, tokens]) => tokens.length >= min)
    .map(([word]) => word)
    .sort();
}

/* ── The sampling pipeline ────────────────────────────────────────────────── */

export interface Candidate {
  token: string;
  /** Probability after every filter in the pipeline has been applied. */
  probability: number;
  /** Probability from the raw model, before temperature or any filter. */
  baseProbability: number;
  /** Removed by top-k or top-p — shown greyed rather than dropped. */
  excluded: boolean;
}

/**
 * Numerically-stable softmax.
 *
 * Subtracting the max before exponentiating is mathematically a no-op — the
 * constant cancels — and practically the difference between a working function
 * and `NaN`. At temperature 0.05 a logit of 3 becomes 60, and `Math.exp` of a
 * few hundred is `Infinity`, which makes every probability `Infinity/Infinity`.
 * Low temperature is exactly the setting a reader will drag to first.
 */
export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const total = exps.reduce((sum, e) => sum + e, 0);
  return exps.map((e) => e / total);
}

/**
 * Divide the logits by the temperature.
 *
 * T < 1 spreads the logits apart, so the leader pulls away and the distribution
 * sharpens. T > 1 squashes them together toward uniform. T = 1 changes nothing.
 *
 * T = 0 is a division by zero, and every real implementation special-cases it to
 * mean greedy — always take the argmax. Returning `Infinity` here and letting
 * softmax sort it out would give NaN, so the special case is explicit.
 *
 * Ties are broken by position, which is what `argmax` does and what makes greedy
 * decoding reproducible. Sharing the mass between equal-count tokens looked like
 * the more honest choice, and was wrong: it leaves the RNG in the loop, so
 * "temperature 0" would produce different text for different seeds. This corpus
 * has ties at exactly the first step from "the", so the bug showed up
 * immediately in the determinism test rather than lurking.
 *
 * Worth knowing that this is also where real reproducibility claims fray. Greedy
 * decoding is deterministic given identical logits, but batching and GPU
 * floating-point reduction order can perturb the logits themselves — so two
 * tokens that are genuinely near-tied may swap, and a "deterministic" endpoint
 * can still return different text.
 */
export function applyTemperature(logits: number[], temperature: number): number[] {
  if (temperature <= 0) {
    // A large finite number rather than Infinity: softmax of Infinity is NaN,
    // softmax of 1e9 is a clean one-hot vector.
    const best = logits.indexOf(Math.max(...logits));
    return logits.map((_, i) => (i === best ? 1e9 : -1e9));
  }
  return logits.map((l) => l / temperature);
}

/** Keep the `k` highest-probability tokens. `k <= 0` disables the filter. */
export function topK(probabilities: number[], k: number): boolean[] {
  if (k <= 0 || k >= probabilities.length) return probabilities.map(() => true);

  const threshold = [...probabilities].sort((a, b) => b - a)[k - 1]!;
  let kept = 0;
  // Walk in the given order and stop at exactly k, so ties at the boundary do
  // not quietly let k+1 tokens through.
  return probabilities.map((p) => {
    if (p >= threshold && kept < k) {
      kept++;
      return true;
    }
    return false;
  });
}

/**
 * Nucleus sampling: keep the smallest set of tokens whose cumulative
 * probability reaches `p`, taking them in descending order.
 *
 * The token that *crosses* the threshold is included — otherwise `p = 0.9` on a
 * distribution whose top token already holds 0.95 would keep nothing at all, and
 * the sampler would have no candidates. This inclusive boundary is what makes
 * top-p adaptive: on a confident distribution it keeps one token, on a flat one
 * it keeps many, which is the whole reason to prefer it to a fixed k.
 */
export function topP(probabilities: number[], p: number): boolean[] {
  if (p >= 1) return probabilities.map(() => true);

  const order = probabilities
    .map((probability, i) => ({ probability, i }))
    .sort((a, b) => b.probability - a.probability);

  const keep = new Array<boolean>(probabilities.length).fill(false);
  let cumulative = 0;

  for (const { probability, i } of order) {
    keep[i] = true;
    cumulative += probability;
    if (cumulative >= p) break;
  }

  return keep;
}

export interface SamplingOptions {
  temperature: number;
  /** 0 disables. */
  topK: number;
  /** 1 disables. */
  topP: number;
}

export const DEFAULT_OPTIONS: SamplingOptions = {
  temperature: 1,
  topK: 0,
  topP: 1,
};

/**
 * The full pipeline, in the order every major inference stack applies it:
 * temperature, then top-k, then top-p, then renormalise.
 *
 * The order matters and is worth stating: because temperature is applied
 * **first**, raising it does not merely flatten the odds — it changes which
 * tokens survive the top-p cut, since flattening pushes probability out of the
 * leader and into the tail until the nucleus has to widen to reach p. That
 * coupling is why "temperature 1.4 with top-p 0.9" behaves nothing like either
 * setting alone, and it is the single most-misunderstood thing about these two
 * knobs.
 */
export function distribution(tokens: Token[], options: SamplingOptions): Candidate[] {
  const logits = tokens.map((t) => t.logit);
  const baseProbabilities = softmax(logits);

  const scaled = softmax(applyTemperature(logits, options.temperature));

  const keepK = topK(scaled, options.topK);
  // top-p reads the post-top-k distribution, so an excluded token cannot
  // contribute its mass toward reaching the threshold.
  const afterK = scaled.map((p, i) => (keepK[i] ? p : 0));
  const keepP = topP(afterK, options.topP);

  const keep = keepK.map((k, i) => k && keepP[i]!);
  const total = scaled.reduce((sum, p, i) => (keep[i] ? sum + p : sum), 0);

  return tokens.map((token, i) => ({
    token: token.token,
    baseProbability: baseProbabilities[i]!,
    probability: keep[i] && total > 0 ? scaled[i]! / total : 0,
    excluded: !keep[i],
  }));
}

/**
 * Shannon entropy in bits — how undecided the distribution is.
 *
 * The honest single number for "how random will this output be". Temperature is
 * a knob; entropy is the effect, and unlike temperature it is comparable across
 * different distributions.
 */
export function entropy(candidates: Candidate[]): number {
  return -candidates
    .filter((c) => c.probability > 0)
    .reduce((sum, c) => sum + c.probability * Math.log2(c.probability), 0);
}

/** Effective vocabulary: 2^entropy — roughly how many tokens are in play. */
export function perplexity(candidates: Candidate[]): number {
  return 2 ** entropy(candidates);
}

/* ── Generation ───────────────────────────────────────────────────────────── */

/**
 * Seeded PRNG (mulberry32).
 *
 * `Math.random()` would make the widget produce different text on every render,
 * including between the server-rendered HTML and the hydrated React tree — a
 * hydration mismatch. Seeding also lets the page make a checkable claim: this
 * seed at this temperature produces exactly this sentence.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF sampling over the surviving candidates. */
export function sample(candidates: Candidate[], rng: () => number): string {
  const live = candidates.filter((c) => c.probability > 0);
  if (live.length === 0) return '';

  let r = rng();
  for (const candidate of live) {
    r -= candidate.probability;
    if (r <= 0) return candidate.token;
  }
  // Floating-point residue can leave r a hair above 0 after the loop. Falling
  // back to the last live candidate is correct and cannot return undefined.
  return live[live.length - 1]!.token;
}

export interface GenerationStep {
  token: string;
  candidates: Candidate[];
  entropy: number;
}

export function generate(
  model: BigramModel,
  start: string,
  options: SamplingOptions,
  seed: number,
  length = 12,
): GenerationStep[] {
  const rng = makeRng(seed);
  const steps: GenerationStep[] = [];
  let current = start;

  for (let i = 0; i < length; i++) {
    const tokens = model.get(current);
    // A word that only ever ends the corpus has no continuation. Stopping is
    // the honest behaviour — this is the bigram model's version of an EOS.
    if (!tokens || tokens.length === 0) break;

    const candidates = distribution(tokens, options);
    const next = sample(candidates, rng);
    if (!next) break;

    steps.push({ token: next, candidates, entropy: entropy(candidates) });
    current = next;
  }

  return steps;
}

export function textOf(start: string, steps: GenerationStep[]): string {
  return [start, ...steps.map((s) => s.token)].join(' ');
}
