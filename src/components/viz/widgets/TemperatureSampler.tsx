import { useMemo, useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  branchingWords,
  buildBigramModel,
  distribution,
  entropy,
  generate,
  perplexity,
  textOf,
  type SamplingOptions,
} from '../traces/sampling.ts';

/**
 * The sampling page's centrepiece.
 *
 * Three things it makes visible that prose consistently fails to:
 *
 * 1. **Temperature and top-p are coupled.** Because temperature is applied
 *    first, raising it pushes mass out of the leader and into the tail, so the
 *    nucleus has to widen to reach p. Drag temperature with top-p at 0.9 and
 *    watch the number of surviving tokens grow — that is why "temperature 1.4
 *    with top-p 0.9" behaves like neither setting alone.
 * 2. **Temperature 0 is not "the best answer", it is a loop.** The generated
 *    text collapses into a repeating cycle, immediately and visibly.
 * 3. **Entropy is the honest readout.** Temperature is a knob whose effect
 *    depends on the distribution it acts on; entropy measures the effect and is
 *    comparable across distributions.
 *
 * The distribution is a real bigram model counted from a corpus that ships with
 * the module — see `traces/sampling.ts` for why that makes this the real
 * algorithm rather than an illustration of it.
 */

const SEEDS = [42, 7, 2024, 101];

export function TemperatureSampler() {
  const model = useMemo(() => buildBigramModel(), []);
  const words = useMemo(() => branchingWords(model, 3), [model]);

  const [word, setWord] = useState('the');
  const [temperature, setTemperature] = useState(1);
  const [k, setK] = useState(0);
  const [p, setP] = useState(1);
  const [seed, setSeed] = useState(SEEDS[0]!);

  const options: SamplingOptions = { temperature, topK: k, topP: p };

  const candidates = useMemo(
    () => distribution(model.get(word) ?? [], options),
    [model, word, temperature, k, p],
  );

  const live = candidates.filter((c) => !c.excluded);
  const bits = entropy(candidates);
  const effective = perplexity(candidates);

  const text = useMemo(
    () => textOf(word, generate(model, word, options, seed, 14)),
    [model, word, temperature, k, p, seed],
  );

  // The tallest bar sets the scale, so a sharpened distribution does not just
  // shrink everything into invisibility.
  const peak = Math.max(
    ...candidates.map((c) => Math.max(c.probability, c.baseProbability)),
    0.01,
  );

  return (
    <VizFrame
      title="Sampling from a real next-word distribution"
      intro="These probabilities are counted from a corpus that ships with the widget — nothing here is invented. Drag the knobs and watch which tokens survive."
      caption={
        temperature === 0
          ? 'Temperature 0 is greedy: always the single most likely token. Reproducible, and — look at the output — a loop.'
          : `${live.length} of ${candidates.length} tokens survive. Entropy ${bits.toFixed(2)} bits, an effective choice of about ${effective.toFixed(1)} tokens.`
      }
    >
      <div className="sampler__controls">
        <label>
          <span>after the word</span>
          <select
            className="viz-select"
            value={word}
            onChange={(e) => setWord(e.target.value)}
          >
            {words.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>
            temperature <strong>{temperature.toFixed(2)}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </label>

        <label>
          <span>
            top-p <strong>{p.toFixed(2)}</strong>
            {p === 1 && <em> (off)</em>}
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={p}
            onChange={(e) => setP(Number(e.target.value))}
          />
        </label>

        <label>
          <span>
            top-k <strong>{k === 0 ? '—' : k}</strong>
            {k === 0 && <em> (off)</em>}
          </span>
          <input
            type="range"
            min={0}
            max={8}
            step={1}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          />
        </label>
      </div>

      <ol className="sampler__bars">
        {candidates.map((c) => (
          <li
            key={c.token}
            className={`sampler__row${c.excluded ? ' sampler__row--out' : ''}`}
          >
            <span className="sampler__token">{c.token}</span>
            <span className="sampler__track">
              {/* Ghost bar: the untouched model probability, so the effect of
                  temperature is a comparison rather than a memory test. */}
              <span
                className="sampler__bar sampler__bar--base"
                style={{ width: `${(c.baseProbability / peak) * 100}%` }}
              />
              <span
                className="sampler__bar"
                style={{ width: `${(c.probability / peak) * 100}%` }}
              />
            </span>
            <span className="sampler__pct">
              {c.excluded ? 'cut' : `${(c.probability * 100).toFixed(1)}%`}
            </span>
          </li>
        ))}
      </ol>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>entropy</dt>
          <dd>
            <span className="viz-counters__value">{bits.toFixed(2)}</span>
            <span className="viz-counters__expected"> bits</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>effective choices</dt>
          <dd>
            <span className="viz-counters__value">{effective.toFixed(1)}</span>
            <span className="viz-counters__expected"> of {candidates.length}</span>
          </dd>
        </div>
      </dl>

      <div className="sampler__output">
        <div className="sampler__output-head">
          <span>generated</span>
          <span className="sampler__seeds">
            seed
            {SEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`sampler__seed${s === seed ? ' sampler__seed--on' : ''}`}
                onClick={() => setSeed(s)}
              >
                {s}
              </button>
            ))}
          </span>
        </div>
        <p className="sampler__text">{text}</p>
        {temperature === 0 && (
          <p className="sampler__note">
            Every seed gives this same output — and it repeats forever. Greedy decoding
            is a deterministic walk over finitely many states, so it must eventually
            revisit one and cycle. Reproducibility and usefulness are not the same
            thing.
          </p>
        )}
      </div>
    </VizFrame>
  );
}
