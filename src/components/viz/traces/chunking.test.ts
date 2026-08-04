import { describe, expect, it } from 'vitest';
import {
  ANSWER_SENTENCE,
  chunkBySentence,
  chunkFixed,
  DOCUMENT,
  overlapTerms,
  QUESTIONS,
  retrieve,
  words,
  type Strategy,
} from './chunking.ts';

const flat = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const ask = (size: number, overlap: number, strategy: Strategy = 'fixed') =>
  retrieve(QUESTIONS[0]!, { size, overlap, strategy });

describe('the document', () => {
  it('contains the answer sentence exactly once', () => {
    const haystack = flat(DOCUMENT);
    const needle = flat(ANSWER_SENTENCE);
    expect(haystack).toContain(needle);
    expect(haystack.split(needle)).toHaveLength(2);
  });

  it('places the answer where a chunk boundary can land on it', () => {
    // The widget's central demonstration depends on this. If an edit moved the
    // answer to the very start or end of the document, the split-answer case
    // would become unreachable and the page's claim would quietly stop being
    // demonstrable — so it is pinned here.
    const position = flat(DOCUMENT).indexOf(flat(ANSWER_SENTENCE));
    const fraction = position / flat(DOCUMENT).length;
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.85);
  });
});

describe('chunkFixed', () => {
  it('covers the whole document', () => {
    const chunks = chunkFixed(DOCUMENT, { size: 40, overlap: 0 });
    expect(chunks.map((c) => c.text).join(' ')).toBe(words(DOCUMENT).join(' '));
  });

  it('respects the requested size', () => {
    const chunks = chunkFixed(DOCUMENT, { size: 30, overlap: 0 });
    for (const chunk of chunks.slice(0, -1)) {
      expect(words(chunk.text)).toHaveLength(30);
    }
    // The last chunk is whatever is left.
    expect(words(chunks.at(-1)!.text).length).toBeLessThanOrEqual(30);
  });

  it('repeats exactly `overlap` words between neighbours', () => {
    const chunks = chunkFixed(DOCUMENT, { size: 40, overlap: 10 });
    for (let i = 1; i < chunks.length; i++) {
      const previous = words(chunks[i - 1]!.text);
      const current = words(chunks[i]!.text);
      expect(current.slice(0, 10)).toEqual(previous.slice(-10));
    }
  });

  it('terminates when overlap is greater than or equal to size', () => {
    // Without the clamp the stride is zero and this loops forever, hanging the
    // page rather than returning something wrong. A slider can reach this.
    expect(() => chunkFixed(DOCUMENT, { size: 20, overlap: 20 })).not.toThrow();
    expect(() => chunkFixed(DOCUMENT, { size: 20, overlap: 50 })).not.toThrow();
    expect(chunkFixed(DOCUMENT, { size: 20, overlap: 99 }).length).toBeGreaterThan(1);
  });

  it('produces more chunks as overlap rises', () => {
    const none = chunkFixed(DOCUMENT, { size: 50, overlap: 0 }).length;
    const some = chunkFixed(DOCUMENT, { size: 50, overlap: 25 }).length;
    // The storage cost of overlap, made concrete: half the stride, ~double the
    // chunks, ~double the vectors to store and search.
    expect(some).toBeGreaterThan(none);
  });

  it('never emits an empty chunk', () => {
    for (const size of [10, 25, 60, 200]) {
      for (const overlap of [0, 5, 20]) {
        for (const chunk of chunkFixed(DOCUMENT, { size, overlap })) {
          expect(chunk.text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('chunkBySentence', () => {
  it('never splits a sentence', () => {
    const chunks = chunkBySentence(DOCUMENT, 40);
    for (const chunk of chunks) {
      // Every chunk ends where a sentence ends.
      expect(chunk.text.trim().endsWith('.')).toBe(true);
    }
  });

  it('keeps the answer sentence intact at every size', () => {
    // The structural guarantee that fixed-size chunking cannot make.
    for (const size of [20, 30, 50, 80, 120]) {
      const joined = chunkBySentence(DOCUMENT, size).map((c) => flat(c.text));
      expect(joined.some((text) => text.includes(flat(ANSWER_SENTENCE)))).toBe(true);
    }
  });

  it('covers the document without loss', () => {
    const chunks = chunkBySentence(DOCUMENT, 50);
    expect(flat(chunks.map((c) => c.text).join(' '))).toBe(flat(DOCUMENT));
  });
});

describe('retrieval', () => {
  it('finds the answer with a sensible chunk size', () => {
    const result = ask(60, 15);
    expect(result.answerIntact).toBe(true);
    expect(result.answerRank).toBe(1);
    expect(result.answerRetrieved).toBe(true);
  });

  it('breaks when chunks are too small to hold the answer', () => {
    // The failure the page is built around, asserted rather than described.
    // The answer sentence is longer than the chunk, so no chunk can contain it
    // and retrieval cannot return it however good the ranking is.
    const result = ask(8, 0);
    expect(result.answerIntact).toBe(false);
    expect(result.answerRetrieved).toBe(false);
  });

  it('is rescued by overlap at a size that otherwise splits the answer', () => {
    // Find a size where zero-overlap splits the answer, then show overlap
    // recovering it. Searched rather than hardcoded, so an edit to the document
    // cannot silently make this test vacuous.
    const broken = [16, 18, 20, 22, 24, 26, 28, 30, 32].filter(
      (size) => !ask(size, 0).answerIntact,
    );
    expect(broken.length).toBeGreaterThan(0);

    const rescued = broken.filter(
      (size) => ask(size, Math.floor(size / 2)).answerIntact,
    );
    expect(rescued.length).toBeGreaterThan(0);
  });

  it('splits or preserves the answer non-monotonically in chunk size', () => {
    // The page's central empirical claim, and the reason "just use bigger
    // chunks" is not a strategy.
    //
    // Whether a chunk boundary lands inside the answer depends on where the
    // boundaries happen to fall, which has nothing to do with the content. So
    // the working sizes are not an interval: on this document, 22 works, 24
    // splits, 26-28 work, 30-32 split, 34-44 work, 46-50 split. Increasing the
    // size can break retrieval that was working.
    const sizes = [22, 24, 26, 28, 30, 32, 34, 40, 46, 50, 52];
    const intact = sizes.map((size) => ask(size, 0).answerIntact);

    // At least one place where a LARGER chunk is worse than a smaller one.
    const regressions = intact.filter((ok, i) => i > 0 && intact[i - 1] && !ok);
    expect(regressions.length).toBeGreaterThan(0);
  });

  it('makes overlap far more reliable than size alone', () => {
    // The consequence of the non-monotonicity above: overlap converts a lottery
    // into near-certainty, because a sentence has to be missed by *every*
    // window rather than by one.
    const sizes = [16, 18, 20, 22, 24, 26, 28, 30, 32, 40, 46, 48, 50];
    const withoutOverlap = sizes.filter((size) => ask(size, 0).answerIntact).length;
    const withOverlap = sizes.filter(
      (size) => ask(size, Math.floor(size / 2)).answerIntact,
    ).length;

    expect(withOverlap).toBeGreaterThan(withoutOverlap);
  });

  it('never splits the answer under the sentence strategy', () => {
    for (const size of [20, 40, 80]) {
      expect(ask(size, 0, 'sentence').answerIntact).toBe(true);
    }
  });

  it('ranks by descending score', () => {
    const { ranked } = ask(50, 10);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
      expect(ranked[i]!.rank).toBe(i + 1);
    }
  });

  it('returns scores in [0, 1]', () => {
    for (const question of QUESTIONS) {
      const { ranked } = retrieve(question, {
        size: 50,
        overlap: 10,
        strategy: 'fixed',
      });
      for (const entry of ranked) {
        expect(entry.score).toBeGreaterThanOrEqual(0);
        expect(entry.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it('retrieves something relevant for every sample question', () => {
    for (const question of QUESTIONS) {
      const { ranked } = retrieve(question, {
        size: 60,
        overlap: 15,
        strategy: 'fixed',
      });
      expect(ranked[0]!.score).toBeGreaterThan(0);
      // The top chunk shares vocabulary with the question — a weak but real
      // check that ranking is not arbitrary.
      expect(overlapTerms(question, ranked[0]!.chunk).length).toBeGreaterThan(0);
    }
  });

  it('dilutes the answer as chunks grow', () => {
    // Dilution measured directly — what fraction of the retrieved chunk is the
    // answer — rather than via the cosine score.
    //
    // Scores are NOT comparable across chunk sizes, which is worth stating
    // because it is a trap: the vocabulary and its IDF weights are rebuilt per
    // chunking, so 0.35 under one chunk size and 0.26 under another are numbers
    // from two different spaces. An earlier version of this test asserted the
    // large-chunk score was lower and failed — the score is in fact *higher*,
    // because with a single chunk every term has identical IDF and there is no
    // discrimination left at all. That is the degenerate case, not a better one.
    const share = (size: number) => {
      const { ranked } = ask(size, 0);
      const holder = ranked.find((entry) =>
        flat(entry.chunk.text).includes(flat(ANSWER_SENTENCE)),
      )!;
      return ANSWER_SENTENCE.length / holder.chunk.text.length;
    };

    expect(share(40)).toBeGreaterThan(share(120));
    expect(share(120)).toBeGreaterThan(share(10_000));
  });

  it('has nothing left to rank once the document is one chunk', () => {
    const huge = ask(10_000, 0);
    expect(huge.chunks).toHaveLength(1);
    expect(huge.answerIntact).toBe(true);
    // Retrieval that always returns everything is not retrieval. The generator
    // now receives the whole document and must find the answer itself, which is
    // exactly the lost-in-the-middle problem chunking exists to avoid.
    expect(huge.ranked).toHaveLength(1);
  });

  it('rebuilds the vocabulary per chunking, so IDF really does shift', () => {
    // Document frequency is counted over chunks, so chunk size changes the
    // weighting of every term. Chunking reshapes the space; it is not a slice.
    const small = ask(20, 0).vocab;
    const large = ask(120, 0).vocab;
    const idfOf = (v: typeof small, term: string) => v.idf[v.index.get(term)!];

    const shared = small.terms.filter((t) => large.index.has(t));
    expect(shared.length).toBeGreaterThan(5);
    expect(shared.some((term) => idfOf(small, term) !== idfOf(large, term))).toBe(true);
  });
});

describe('overlapTerms', () => {
  it('reports the shared vocabulary driving a score', () => {
    const { ranked } = ask(60, 15);
    const terms = overlapTerms('how long are audit logs kept?', ranked[0]!.chunk);
    expect(terms).toContain('audit');
    expect(terms).toContain('logs');
  });

  it('is empty for an unrelated question', () => {
    const { chunks } = ask(60, 15);
    expect(overlapTerms('zzz qqq wwww', chunks[0]!)).toEqual([]);
  });
});
