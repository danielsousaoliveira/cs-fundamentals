import { useMemo, useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  buildSpace,
  cosine,
  euclidean,
  tokenize,
  type Doc,
} from '../traces/embeddings.ts';

/**
 * The embeddings page's centrepiece.
 *
 * Two things it is built to make concrete, both of which are usually asserted:
 *
 * 1. **Similarity is an angle, not a distance.** Pick the two database sentences
 *    of very different lengths and the readout disagrees with itself — cosine
 *    calls them close, Euclidean calls them far. That disagreement is the whole
 *    argument for cosine on text.
 * 2. **A 2-D picture of a 33-dimensional space is a lossy summary.** The caption
 *    states the variance actually retained, out loud, rather than letting the
 *    reader assume the plot is the space. Two dots touching on screen may be
 *    nowhere near each other.
 *
 * Every number here is computed from the visible sentences by
 * `traces/embeddings.ts` — nothing is hand-placed to make the picture tidy.
 */

const TOPIC_COLOR: Record<Doc['topic'], string> = {
  database: 'var(--viz-role-active-border)',
  cooking: 'var(--viz-role-compare-border)',
  finance: 'var(--viz-role-sorted-border)',
};

const WIDTH = 560;
const MIN_HEIGHT = 170;
const MAX_HEIGHT = 320;
const PAD = 34;

export function VectorSpace() {
  const space = useMemo(() => buildSpace(), []);
  const [a, setA] = useState('d1');
  const [b, setB] = useState('d3');

  const indexOf = (id: string) => space.docs.findIndex((doc) => doc.id === id);
  const vectorOf = (id: string) => space.vectors[indexOf(id)]!;
  const docOf = (id: string) => space.docs[indexOf(id)]!;

  // Map the PCA coordinates into the viewBox.
  //
  // Both axes share ONE scale factor. Fitting each axis independently would
  // fill the box more neatly and would also be a lie: it stretches one
  // direction relative to the other, so two dots that look equally far apart
  // are not — in a widget whose entire purpose is asking the reader to judge
  // distance. Equal aspect is the constraint; the box adapts to the data
  // rather than the other way round.
  //
  // So the height is derived from the data's own aspect ratio instead of being
  // fixed. PCA output is wide and flat by construction — the first component
  // captures more spread than the second, always — and a fixed square box
  // leaves most of its vertical space empty.
  const { placed, height } = useMemo(() => {
    const pts = space.projection.points;
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(...xs) - minX || 1;
    const spanY = Math.max(...ys) - minY || 1;

    // Constrained by BOTH axes, not just the wider one. Scaling to fill the
    // width alone overflows whenever the vertical range is the binding one —
    // which it is for this corpus — and silently clips the outlying points off
    // the top and bottom of the box.
    const scale = Math.min((WIDTH - PAD * 2) / spanX, (MAX_HEIGHT - PAD * 2) / spanY);
    const height = Math.max(MIN_HEIGHT, spanY * scale + PAD * 2);

    return {
      height,
      placed: pts.map(([x, y], i) => ({
        doc: space.docs[i]!,
        // Centre horizontally: when height is the binding constraint the points
        // no longer span the full width, and left-aligning them looks broken.
        x: (WIDTH - spanX * scale) / 2 + (x - minX) * scale,
        // Flipped: SVG y grows downward, the projection's does not.
        y: height / 2 - (y - (minY + spanY / 2)) * scale,
      })),
    };
  }, [space]);

  const cos = cosine(vectorOf(a), vectorOf(b));
  const euc = euclidean(vectorOf(a), vectorOf(b));
  const angle = (Math.acos(cos) * 180) / Math.PI;

  const shared = useMemo(() => {
    const inB = new Set(tokenize(docOf(b).text));
    return [...new Set(tokenize(docOf(a).text))].filter((term) => inB.has(term));
  }, [a, b]);

  // Rank every other document against `a` by each metric. Where the two columns
  // disagree is the lesson; nothing else on the page argues it as directly.
  const rankings = useMemo(() => {
    const others = space.docs.filter((doc) => doc.id !== a);
    return {
      byCosine: [...others].sort(
        (p, q) =>
          cosine(vectorOf(a), vectorOf(q.id)) - cosine(vectorOf(a), vectorOf(p.id)),
      ),
      byEuclidean: [...others].sort(
        (p, q) =>
          euclidean(vectorOf(a), vectorOf(p.id)) -
          euclidean(vectorOf(a), vectorOf(q.id)),
      ),
    };
  }, [a, space]);

  const disagree = rankings.byCosine[0]!.id !== rankings.byEuclidean[0]!.id;

  const pointA = placed[indexOf(a)]!;
  const pointB = placed[indexOf(b)]!;

  const select = (id: string) => {
    // Clicking the current primary swaps the pair rather than doing nothing,
    // so the plot is never in a state where a click has no visible effect.
    if (id === a) (setA(b), setB(a));
    else if (id !== b) (setB(a), setA(id));
  };

  return (
    <VizFrame
      title="Ten sentences as points in a 33-dimensional space"
      intro="Click any two sentences. Every number below is computed from the words you can see — these are TF-IDF vectors, not a neural model."
      caption={
        cos === 0
          ? `“${docOf(a).text}” and “${docOf(b).text}” share no words at all, so the angle between them is a right angle and the similarity is exactly 0 — whatever they mean.`
          : `Cosine ${cos.toFixed(3)} — an angle of ${angle.toFixed(0)}°. Shared terms: ${shared.join(', ')}.`
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="vector-space"
        // `group`, not `img`. Each point is a real button, and `role="img"`
        // declares the subtree atomic — which puts interactive controls inside
        // something announced as a picture. axe flags it as `nested-interactive`
        // and it is right to: a screen-reader user would be told there is an
        // image here and never reach the ten controls inside it.
        //
        // The plot is not the only route to this information either. The two
        // ranked lists below carry the same content as text, and the selects
        // duplicate every control here — so nothing is reachable only by
        // clicking a circle.
        role="group"
        aria-label={`Sentences projected onto two principal components, retaining ${(space.projection.explained * 100).toFixed(0)} percent of the variance. Select any two to compare.`}
      >
        <line
          className="vector-space__link"
          x1={pointA.x}
          y1={pointA.y}
          x2={pointB.x}
          y2={pointB.y}
        />

        {placed.map(({ doc, x, y }) => {
          const role = doc.id === a ? 'a' : doc.id === b ? 'b' : 'idle';
          return (
            <g key={doc.id} className={`vector-space__pt vector-space__pt--${role}`}>
              <circle
                cx={x}
                cy={y}
                r={role === 'idle' ? 7 : 11}
                style={{ fill: TOPIC_COLOR[doc.topic] }}
                tabIndex={0}
                role="button"
                aria-label={`${doc.text} — ${doc.topic}`}
                onClick={() => select(doc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(doc.id);
                  }
                }}
              />
              {role !== 'idle' && (
                <text className="vector-space__badge" x={x} y={y + 4}>
                  {role.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="vector-space__lossy">
        These two axes retain{' '}
        <strong>{(space.projection.explained * 100).toFixed(1)}%</strong> of the
        variance in the full 33 dimensions. Two dots touching on screen are not
        necessarily neighbours — read the numbers, not the picture.
      </p>

      <div className="vector-space__pair">
        {(['a', 'b'] as const).map((slot) => {
          const doc = docOf(slot === 'a' ? a : b);
          return (
            <label
              key={slot}
              className={`vector-space__slot vector-space__slot--${slot}`}
            >
              <span>{slot.toUpperCase()}</span>
              <select
                className="viz-select"
                value={doc.id}
                onChange={(e) =>
                  slot === 'a' ? setA(e.target.value) : setB(e.target.value)
                }
              >
                {space.docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.text}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>cosine</dt>
          <dd>
            <span className="viz-counters__value">{cos.toFixed(3)}</span>
            <span className="viz-counters__expected"> {angle.toFixed(0)}° apart</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>euclidean</dt>
          <dd>
            <span className="viz-counters__value">{euc.toFixed(2)}</span>
            <span className="viz-counters__expected"> length-sensitive</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>shared terms</dt>
          <dd>
            <span className="viz-counters__value">{shared.length}</span>
            <span className="viz-counters__expected">
              {' '}
              of {space.vocab.terms.length} dimensions
            </span>
          </dd>
        </div>
      </dl>

      <div className="vector-space__ranks">
        {(
          [
            ['nearest by cosine', rankings.byCosine],
            ['nearest by euclidean', rankings.byEuclidean],
          ] as const
        ).map(([label, list]) => (
          <div key={label}>
            <h4>{label}</h4>
            <ol>
              {list.slice(0, 3).map((doc) => (
                <li key={doc.id}>
                  <span
                    className="vector-space__swatch"
                    style={{ background: TOPIC_COLOR[doc.topic] }}
                    aria-hidden="true"
                  />
                  {doc.text}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {disagree && (
        <p className="vector-space__note">
          The two metrics disagree about the nearest sentence right now. Euclidean
          distance is counting sentence length as a difference in meaning; cosine is
          ignoring it.
        </p>
      )}
    </VizFrame>
  );
}
