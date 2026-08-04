/**
 * Vector-space arithmetic for the embeddings page.
 *
 * A deliberate honesty constraint shapes this whole module. The site's standard
 * is that a visualisation must not lie about the thing it claims to show, and
 * this environment cannot call an embedding model — so shipping hand-invented
 * "embedding" coordinates chosen to make a nice picture would be exactly the
 * kind of fabrication the rest of the project refuses.
 *
 * So the widget uses TF-IDF vectors instead, computed here, in full, from a
 * corpus that ships with it. Every number on screen is derived from text the
 * reader can see. TF-IDF is not a neural embedding, but it is a real vector
 * representation of meaning — historically the first one — and it shares the
 * parts the page is actually teaching:
 *
 *   - a document becomes a point in a high-dimensional space
 *   - similarity is an angle, not a distance
 *   - the angle is invariant to how long the document is
 *
 * And it differs in exactly one instructive way: TF-IDF cannot see synonyms. Two
 * sentences that mean the same thing in different words score 0. That failure is
 * the entire motivation for learned embeddings, so the widget demonstrating it is
 * a feature rather than a compromise — see `SYNONYM_PAIR` and its test.
 */

export interface Doc {
  id: string;
  text: string;
  /** Rough topic, used only for colouring the plot. Never fed to the maths. */
  topic: 'database' | 'cooking' | 'finance';
}

/**
 * Three topics, deliberately unbalanced in length, with two near-duplicate pairs
 * and one synonym pair that shares no vocabulary at all.
 */
export const CORPUS: Doc[] = [
  { id: 'd1', text: 'the database index speeds up the query', topic: 'database' },
  { id: 'd2', text: 'a query without an index scans every row', topic: 'database' },
  {
    id: 'd3',
    text: 'adding an index to the database makes the query faster but slows down every write to the table',
    topic: 'database',
  },
  { id: 'd4', text: 'the query planner chose a sequential scan', topic: 'database' },

  { id: 'd5', text: 'heat the pan and add the onion', topic: 'cooking' },
  { id: 'd6', text: 'add the onion to the hot pan', topic: 'cooking' },
  { id: 'd7', text: 'simmer the sauce until the liquid reduces', topic: 'cooking' },

  { id: 'd8', text: 'the interest rate on the loan went up', topic: 'finance' },
  { id: 'd9', text: 'rising rates make borrowing more expensive', topic: 'finance' },
  { id: 'd10', text: 'the bank raised the rate on every loan', topic: 'finance' },
];

/**
 * The pair the page is built around: same meaning, zero shared words.
 *
 * `d8` "the interest rate on the loan went up" and `d9` "rising rates make
 * borrowing more expensive" are the same statement. Their only overlap is
 * "rate"/"rates", which the tokenizer below does not stem — so TF-IDF scores
 * them near zero and a learned embedding would score them high. Asserted in the
 * test suite so the claim on the page cannot drift away from the code.
 */
export const SYNONYM_PAIR: readonly [string, string] = ['d8', 'd9'];

/**
 * Words carrying no topical signal. Kept deliberately short: a long stop-list
 * would hide how much of TF-IDF's work is just down-weighting common words,
 * which is the point of the IDF term.
 */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'to',
  'of',
  'on',
  'in',
  'up',
  'but',
  'every',
  'without',
  'until',
  'more',
  'make',
  'makes',
  'went',
  'chose',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

export interface Vocabulary {
  /** Terms in a fixed order — this ordering IS the dimension ordering. */
  terms: string[];
  index: Map<string, number>;
  /** Inverse document frequency per term, aligned with `terms`. */
  idf: number[];
}

/**
 * Smoothed IDF: `ln(1 + N / df)`.
 *
 * The `1 +` matters. The unsmoothed `ln(N / df)` sends a term appearing in every
 * document to exactly zero, which deletes the dimension — and with a corpus this
 * small that silently collapses the space. Smoothing keeps the dimension alive
 * but nearly weightless, which is the behaviour the reader expects when they see
 * a common word listed in the vocabulary.
 */
export function buildVocabulary(docs: Doc[]): Vocabulary {
  const documentFrequency = new Map<string, number>();

  for (const doc of docs) {
    for (const term of new Set(tokenize(doc.text))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const terms = [...documentFrequency.keys()].sort();
  const index = new Map(terms.map((term, i) => [term, i]));
  const idf = terms.map((term) =>
    Math.log(1 + docs.length / documentFrequency.get(term)!),
  );

  return { terms, index, idf };
}

/** The raw, unnormalised TF-IDF vector for a piece of text. */
export function vectorize(text: string, vocab: Vocabulary): number[] {
  const vector = new Array<number>(vocab.terms.length).fill(0);

  for (const term of tokenize(text)) {
    const i = vocab.index.get(term);
    // Terms absent from the corpus have no dimension to live in. This is a real
    // limitation worth surfacing rather than hiding: a query made entirely of
    // unseen words produces the zero vector, and matches nothing.
    if (i !== undefined) vector[i]! += 1;
  }

  return vector.map((tf, i) => tf * vocab.idf[i]!);
}

export function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * b[i]!, 0);
}

export function magnitude(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

/**
 * Cosine similarity — the angle between two vectors, ignoring their lengths.
 *
 * Length-invariance is the whole reason this is the default metric for text.
 * A document that says the same thing twice as long has roughly twice the
 * magnitude and the same direction; Euclidean distance calls that a difference,
 * cosine does not. `euclidean()` exists below so the widget can show the two
 * disagreeing on exactly that case.
 *
 * Returns 0 for a zero vector rather than NaN. The zero vector has no direction,
 * so there is no angle to report, and 0 ("unrelated") is the honest answer —
 * propagating NaN into the UI would be the alternative.
 *
 * The clamp is not cosmetic. `dot(v, v) / (|v| · |v|)` involves a square root
 * and comes back as 1.0000000000000002 for some vectors in this very corpus, and
 * any caller converting a similarity to an angle with `Math.acos` gets NaN from
 * an argument a hair over 1. Caught by the range test rather than by eye.
 */
export function cosine(a: number[], b: number[]): number {
  const denominator = magnitude(a) * magnitude(b);
  if (denominator === 0) return 0;
  return Math.min(1, Math.max(-1, dot(a, b) / denominator));
}

export function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]!) ** 2, 0));
}

export function normalize(v: number[]): number[] {
  const m = magnitude(v);
  return m === 0 ? v : v.map((value) => value / m);
}

/* ── Projection to 2-D ────────────────────────────────────────────────────── */

export interface Projection {
  /** One [x, y] per input vector, in input order. */
  points: [number, number][];
  /** Fraction of total variance the two axes retain, in [0, 1]. */
  explained: number;
}

/**
 * Principal component analysis via power iteration, to two components.
 *
 * Why implement it rather than pick two dimensions to plot: choosing two of ~40
 * vocabulary axes shows the reader an arbitrary slice and invites them to read
 * meaning into whichever words happened to be picked. PCA finds the two
 * directions of greatest spread, which is at least a defensible view.
 *
 * It is still a lossy view, and `explained` is returned so the widget can say so
 * out loud. That number is the honest caption for every 2-D picture of a
 * high-dimensional space — including the t-SNE and UMAP plots the reader will
 * meet elsewhere, where clusters can appear that are not in the data at all.
 */
export function project2d(vectors: number[][], iterations = 200): Projection {
  const n = vectors.length;
  const dims = vectors[0]?.length ?? 0;
  if (n === 0 || dims === 0) return { points: [], explained: 0 };

  const mean = Array.from(
    { length: dims },
    (_, d) => vectors.reduce((sum, v) => sum + v[d]!, 0) / n,
  );
  const centred = vectors.map((v) => v.map((value, d) => value - mean[d]!));

  const totalVariance = centred.reduce((sum, v) => sum + dot(v, v), 0);

  /**
   * Top eigenvector of the covariance matrix, without ever forming it.
   *
   * The covariance is XᵀX/n, so `Cv` can be computed as two passes over the
   * data — project every row onto v, then accumulate rows weighted by those
   * projections. That is O(n·d) per iteration instead of O(d²) memory for a
   * matrix whose side is the vocabulary size.
   */
  const topComponent = (rows: number[][]): number[] => {
    // Deterministic seed. `Math.random()` here would mean the plot's axes
    // flipped between renders, and a widget that redraws differently on refresh
    // teaches the reader that the layout is meaningless.
    let v = normalize(Array.from({ length: dims }, (_, d) => Math.sin(d + 1)));

    for (let i = 0; i < iterations; i++) {
      const next = new Array<number>(dims).fill(0);
      for (const row of rows) {
        const scale = dot(row, v);
        for (let d = 0; d < dims; d++) next[d]! += scale * row[d]!;
      }
      const m = magnitude(next);
      if (m === 0) return v;
      v = next.map((value) => value / m);
    }

    return v;
  };

  const pc1 = topComponent(centred);

  // Deflate: strip pc1 out of every row so the same routine finds pc2. This is
  // what guarantees the two axes are orthogonal rather than both landing on the
  // dominant direction.
  const deflated = centred.map((row) => {
    const scale = dot(row, pc1);
    return row.map((value, d) => value - scale * pc1[d]!);
  });
  const pc2 = topComponent(deflated);

  const points = centred.map(
    (row) => [dot(row, pc1), dot(row, pc2)] as [number, number],
  );

  const kept = points.reduce((sum, [x, y]) => sum + x * x + y * y, 0);

  return {
    points,
    explained: totalVariance === 0 ? 0 : kept / totalVariance,
  };
}

/* ── Convenience for the widget ───────────────────────────────────────────── */

export interface Space {
  vocab: Vocabulary;
  docs: Doc[];
  vectors: number[][];
  projection: Projection;
}

export function buildSpace(docs: Doc[] = CORPUS): Space {
  const vocab = buildVocabulary(docs);
  const vectors = docs.map((doc) => vectorize(doc.text, vocab));
  return { vocab, docs, vectors, projection: project2d(vectors) };
}

export interface Neighbour {
  doc: Doc;
  similarity: number;
}

/** Nearest neighbours by cosine, excluding the query document itself. */
export function nearest(space: Space, id: string, k = 3): Neighbour[] {
  const i = space.docs.findIndex((doc) => doc.id === id);
  if (i === -1) return [];

  return space.docs
    .map((doc, j) => ({
      doc,
      similarity: cosine(space.vectors[i]!, space.vectors[j]!),
    }))
    .filter((_, j) => j !== i)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
