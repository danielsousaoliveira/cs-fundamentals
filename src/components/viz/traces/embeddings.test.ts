import { describe, expect, it } from 'vitest';
import {
  buildSpace,
  buildVocabulary,
  CORPUS,
  cosine,
  dot,
  euclidean,
  magnitude,
  nearest,
  normalize,
  project2d,
  SYNONYM_PAIR,
  tokenize,
  vectorize,
} from './embeddings.ts';

const space = buildSpace();
const vectorFor = (id: string) =>
  space.vectors[space.docs.findIndex((doc) => doc.id === id)]!;

describe('tokenize', () => {
  it('lowercases, splits on non-letters, and drops stop words', () => {
    expect(tokenize('The database INDEX, speeds up the query!')).toEqual([
      'database',
      'index',
      'speeds',
      'query',
    ]);
  });

  it('returns nothing for text that is entirely stop words', () => {
    expect(tokenize('the a an of to')).toEqual([]);
  });
});

describe('vocabulary', () => {
  it('orders terms deterministically', () => {
    // The term ordering is the dimension ordering. If it were unstable, two
    // vectors built in different renders would not be comparable at all.
    expect(buildVocabulary(CORPUS).terms).toEqual(buildVocabulary(CORPUS).terms);
    expect([...space.vocab.terms]).toEqual([...space.vocab.terms].sort());
  });

  it('gives a rarer term a higher idf than a common one', () => {
    const idfOf = (term: string) => space.vocab.idf[space.vocab.index.get(term)!]!;
    // "query" appears in three of the four database sentences; "onion" in two
    // of ten documents overall.
    expect(idfOf('onion')).toBeGreaterThan(idfOf('query'));
  });

  it('never produces a zero idf, so no dimension is deleted', () => {
    // Unsmoothed ln(N/df) would zero out any term present in every document.
    expect(Math.min(...space.vocab.idf)).toBeGreaterThan(0);
  });
});

describe('cosine similarity', () => {
  it('is 1 for a vector against itself', () => {
    const v = vectorFor('d1');
    expect(cosine(v, v)).toBeCloseTo(1, 10);
  });

  it('is invariant to scaling — the property that makes it the right metric', () => {
    // This is the claim the page makes about document length: saying the same
    // thing at twice the length must not change the similarity.
    const a = vectorFor('d1');
    const b = vectorFor('d2');
    const doubled = a.map((x) => x * 2);
    const tenfold = a.map((x) => x * 10);

    expect(cosine(doubled, b)).toBeCloseTo(cosine(a, b), 10);
    expect(cosine(tenfold, b)).toBeCloseTo(cosine(a, b), 10);

    // Euclidean distance, by contrast, is not — which is the contrast the
    // widget draws.
    expect(euclidean(doubled, b)).not.toBeCloseTo(euclidean(a, b), 3);
  });

  it('stays within [-1, 1] across every pair in the corpus', () => {
    for (const a of space.vectors) {
      for (const b of space.vectors) {
        const c = cosine(a, b);
        expect(c).toBeGreaterThanOrEqual(-1);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is never negative for term-frequency vectors', () => {
    // TF-IDF components are all non-negative, so every vector sits in the
    // positive orthant and no two can be more than 90° apart. Worth pinning:
    // it is a real difference from learned embeddings, where opposites can
    // score negative, and the page says so.
    for (const a of space.vectors) {
      for (const b of space.vectors) {
        expect(cosine(a, b)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('returns 0 rather than NaN for the zero vector', () => {
    const zero = new Array(space.vocab.terms.length).fill(0);
    expect(cosine(zero, vectorFor('d1'))).toBe(0);
    expect(cosine(zero, zero)).toBe(0);
  });

  it('scores a paraphrase above an unrelated sentence', () => {
    // d5 "heat the pan and add the onion" vs d6 "add the onion to the hot pan"
    // — different word order, shared vocabulary.
    const paraphrase = cosine(vectorFor('d5'), vectorFor('d6'));
    const unrelated = cosine(vectorFor('d5'), vectorFor('d1'));

    expect(paraphrase).toBeGreaterThan(0.5);
    expect(unrelated).toBeLessThan(0.1);
  });
});

describe('the synonym failure the page is built around', () => {
  it('scores two sentences with the same meaning and no shared words near zero', () => {
    // d8 "the interest rate on the loan went up"
    // d9 "rising rates make borrowing more expensive"
    //
    // A human calls these the same statement. TF-IDF has no dimension in which
    // they overlap, so it calls them unrelated. This test exists so the prose
    // claim on the embeddings page cannot silently drift away from what the
    // widget actually computes — if a future corpus edit gives these two a
    // shared token, the page's whole motivating example stops being true and
    // this goes red.
    const [a, b] = SYNONYM_PAIR;
    expect(cosine(vectorFor(a), vectorFor(b))).toBeLessThan(0.05);
  });

  it('and ranks a merely-lexical match above the true paraphrase', () => {
    // The sharper version of the same failure: d10 "the bank raised the rate on
    // every loan" shares "rate" and "loan" with d8, so it wins — even though d9
    // is the sentence that means the same thing.
    const [a, b] = SYNONYM_PAIR;
    expect(cosine(vectorFor(a), vectorFor('d10'))).toBeGreaterThan(
      cosine(vectorFor(a), vectorFor(b)),
    );
  });
});

describe('normalize', () => {
  it('produces unit vectors', () => {
    expect(magnitude(normalize(vectorFor('d3')))).toBeCloseTo(1, 10);
  });

  it('leaves the zero vector alone instead of dividing by zero', () => {
    const zero = [0, 0, 0];
    expect(normalize(zero)).toEqual(zero);
  });

  it('turns cosine into a plain dot product', () => {
    const a = normalize(vectorFor('d1'));
    const b = normalize(vectorFor('d2'));
    // This is why vector databases store normalised vectors: it lets them use
    // the cheaper inner-product kernel and get cosine for free.
    expect(dot(a, b)).toBeCloseTo(cosine(vectorFor('d1'), vectorFor('d2')), 10);
  });
});

describe('project2d', () => {
  const projection = space.projection;

  it('returns one point per document', () => {
    expect(projection.points).toHaveLength(CORPUS.length);
  });

  it('is deterministic across runs', () => {
    // Seeded rather than random, so the plot's axes do not flip on refresh.
    expect(project2d(space.vectors).points).toEqual(projection.points);
  });

  it('produces orthogonal axes', () => {
    // Deflation is what guarantees this; without it power iteration returns the
    // dominant direction twice and the plot collapses onto a line.
    const xs = projection.points.map(([x]) => x);
    const ys = projection.points.map(([, y]) => y);
    expect(Math.abs(dot(xs, ys))).toBeLessThan(1e-6);
  });

  it('orders the axes by variance', () => {
    const varianceOf = (values: number[]) =>
      values.reduce((sum, v) => sum + v * v, 0) / values.length;
    expect(varianceOf(projection.points.map(([x]) => x))).toBeGreaterThan(
      varianceOf(projection.points.map(([, y]) => y)),
    );
  });

  it('reports a variance fraction in [0, 1] that is honestly incomplete', () => {
    expect(projection.explained).toBeGreaterThan(0);
    expect(projection.explained).toBeLessThan(1);
  });

  it('keeps more variance than any arbitrary pair of raw dimensions', () => {
    // The justification for doing PCA at all rather than plotting two of the
    // vocabulary axes.
    const total = space.vectors.reduce((sum, v) => sum + dot(v, v), 0);
    const dims = space.vocab.terms.length;
    let best = 0;
    for (let d = 0; d < dims; d++) {
      for (let e = d + 1; e < dims; e++) {
        const kept = space.vectors.reduce((sum, v) => sum + v[d]! ** 2 + v[e]! ** 2, 0);
        best = Math.max(best, kept / total);
      }
    }
    expect(projection.explained).toBeGreaterThan(best);
  });

  it('handles degenerate input without throwing', () => {
    expect(project2d([]).points).toEqual([]);
    expect(project2d([[0, 0, 0]]).points).toEqual([[0, 0]]);
  });
});

describe('nearest', () => {
  it('never returns the query document itself', () => {
    for (const doc of CORPUS) {
      expect(nearest(space, doc.id, 5).map((n) => n.doc.id)).not.toContain(doc.id);
    }
  });

  it('returns results in descending similarity', () => {
    const sims = nearest(space, 'd1', 5).map((n) => n.similarity);
    expect([...sims]).toEqual([...sims].sort((a, b) => b - a));
  });

  it('finds the same-topic document first for lexically-overlapping topics', () => {
    // True for cooking and databases, where the topic words repeat. NOT asserted
    // for finance — that is precisely where TF-IDF fails, and the test above
    // pins the failure rather than papering over it here.
    expect(nearest(space, 'd5', 1)[0]!.doc.topic).toBe('cooking');
    expect(nearest(space, 'd1', 1)[0]!.doc.topic).toBe('database');
  });

  it('returns nothing for an unknown id', () => {
    expect(nearest(space, 'nope')).toEqual([]);
  });
});

describe('vectorize', () => {
  it('gives the zero vector for text with no corpus vocabulary', () => {
    const v = vectorize('zzz qqq', space.vocab);
    expect(magnitude(v)).toBe(0);
  });

  it('counts repeated terms', () => {
    const once = vectorize('index', space.vocab);
    const twice = vectorize('index index', space.vocab);
    expect(dot(twice, twice)).toBeCloseTo(4 * dot(once, once), 10);
    // …but the direction is unchanged, so cosine still says they are identical.
    expect(cosine(once, twice)).toBeCloseTo(1, 10);
  });
});
