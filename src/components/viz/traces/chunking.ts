/**
 * Chunking and retrieval over a real document.
 *
 * This module reuses the TF-IDF machinery from `embeddings.ts` rather than
 * inventing a second similarity function, which keeps one honesty story for the
 * whole section: every score the reader sees is computed from text on screen.
 *
 * What the widget built on this demonstrates is a genuinely causal chain, not an
 * illustration of one. Change the chunk size, and the chunk boundaries really
 * move; the vocabulary of each chunk really changes; the TF-IDF vectors really
 * change; and the retrieved chunk really can stop containing the answer. The
 * failure it shows — an answer sentence split across two chunks so that neither
 * one scores well — is produced by the arithmetic, not staged.
 *
 * The one thing to keep in mind reading it: chunk sizes here are in **words**,
 * not tokens, because the document is visible and countable. Production systems
 * chunk by tokens. The behaviour is identical; only the units differ.
 */

import {
  buildVocabulary,
  cosine,
  tokenize,
  vectorize,
  type Vocabulary,
} from './embeddings.ts';

/**
 * A short technical document with a specific property: the answer to the
 * default question ("how long are audit logs kept?") lives in ONE sentence,
 * roughly two thirds of the way through.
 *
 * That placement is deliberate. It puts the answer near a boundary for several
 * common chunk sizes, which is what lets the widget show the split-answer
 * failure without any special-casing — the reader can move a slider and watch a
 * working retrieval stop working.
 */
export const DOCUMENT = `
The platform stores three categories of data. Application data lives in the
primary database and is replicated to a standby in a second region. Object
storage holds user uploads and generated exports. Audit logs are written to a
separate append-only store that the application cannot modify.

Backups of the primary database run nightly and are kept for thirty days. A
restore is tested monthly against a scratch environment. Object storage is
versioned, so a deleted upload can be recovered for seven days before the
version is purged permanently.

Audit logs are retained for four hundred days to satisfy the compliance
requirement, after which they are deleted automatically. Access to the audit
store is granted per request and every read is itself audited. Requests for
older records must be filed with the security team, who can retrieve from cold
storage within five working days.

Encryption keys are managed by the cloud provider's key service and rotated
every ninety days. Application secrets live in the secret manager and are
injected at deploy time. No secret is ever written to a log line, and the log
pipeline drops any field whose name matches the denylist.
`;

/** The sentence a correct retrieval must return, for the default question. */
export const ANSWER_SENTENCE =
  'Audit logs are retained for four hundred days to satisfy the compliance requirement';

export const QUESTIONS = [
  'how long are audit logs kept?',
  'when is a deleted upload recoverable?',
  'how often are encryption keys rotated?',
  'are database backups tested?',
];

export interface Chunk {
  id: string;
  index: number;
  text: string;
  /** Word offsets into the source document — used to draw the overlap. */
  start: number;
  end: number;
}

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export interface ChunkOptions {
  /** Words per chunk. */
  size: number;
  /** Words repeated from the end of the previous chunk. */
  overlap: number;
}

/**
 * Fixed-size chunking with overlap — the naive strategy, and by far the most
 * widely deployed one.
 *
 * The overlap is clamped to `size - 1`. At `overlap >= size` the stride becomes
 * zero or negative and the loop never advances, which is an infinite loop rather
 * than a bad result; a slider that can produce that state would hang the page.
 */
export function chunkFixed(text: string, { size, overlap }: ChunkOptions): Chunk[] {
  const all = words(text);
  const safeOverlap = Math.max(0, Math.min(overlap, size - 1));
  const stride = size - safeOverlap;

  const chunks: Chunk[] = [];
  for (let start = 0; start < all.length; start += stride) {
    const end = Math.min(start + size, all.length);
    chunks.push({
      id: `c${chunks.length}`,
      index: chunks.length,
      text: all.slice(start, end).join(' '),
      start,
      end,
    });
    if (end === all.length) break;
  }

  return chunks;
}

/**
 * Chunk on sentence boundaries, packing sentences until the size limit.
 *
 * The strategy fixed-size chunking is usually losing to, and the widget lets the
 * reader compare them on the same document. It cannot split a sentence, so the
 * split-answer failure becomes impossible — at the cost of uneven chunk sizes,
 * which matters if downstream code assumes uniformity.
 */
export function chunkBySentence(text: string, size: number): Chunk[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=\.)\s+/)
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let start = 0;
  let cursor = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = current.join(' ');
    chunks.push({
      id: `c${chunks.length}`,
      index: chunks.length,
      text,
      start,
      end: cursor,
    });
    current = [];
    start = cursor;
  };

  for (const sentence of sentences) {
    const length = words(sentence).length;
    if (current.length > 0 && cursor - start + length > size) flush();
    current.push(sentence);
    cursor += length;
  }
  flush();

  return chunks;
}

export type Strategy = 'fixed' | 'sentence';

export interface Retrieved {
  chunk: Chunk;
  score: number;
  rank: number;
}

export interface RetrievalResult {
  chunks: Chunk[];
  ranked: Retrieved[];
  vocab: Vocabulary;
  /** Whether the answer sentence survives intact inside any single chunk. */
  answerIntact: boolean;
  /** Whether the top-ranked chunk contains the answer sentence whole. */
  answerRetrieved: boolean;
  /** Index of the highest-ranked chunk containing the whole answer, or -1. */
  answerRank: number;
}

/** Normalised for comparison — the widget's document has line breaks in it. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function retrieve(
  question: string,
  options: ChunkOptions & { strategy: Strategy },
  document: string = DOCUMENT,
  answer: string = ANSWER_SENTENCE,
): RetrievalResult {
  const chunks =
    options.strategy === 'sentence'
      ? chunkBySentence(document, options.size)
      : chunkFixed(document, options);

  // The vocabulary is built over the CHUNKS, not the document — which is the
  // real behaviour and the source of a subtle effect worth seeing: changing the
  // chunk size changes every chunk's IDF weighting, because document frequency
  // is counted over chunks. Chunking is not just slicing; it reshapes the space.
  const docs = chunks.map((chunk) => ({
    id: chunk.id,
    text: chunk.text,
    topic: 'database' as const,
  }));
  const vocab = buildVocabulary(docs);

  const queryVector = vectorize(question, vocab);
  const ranked = chunks
    .map((chunk) => ({
      chunk,
      score: cosine(queryVector, vectorize(chunk.text, vocab)),
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));

  const needle = flatten(answer);
  const holder = ranked.find((entry) => flatten(entry.chunk.text).includes(needle));

  return {
    chunks,
    ranked,
    vocab,
    answerIntact: holder !== undefined,
    answerRetrieved: holder?.rank === 1,
    answerRank: holder?.rank ?? -1,
  };
}

/** Words shared between the question and a chunk — why it scored what it did. */
export function overlapTerms(question: string, chunk: Chunk): string[] {
  const inChunk = new Set(tokenize(chunk.text));
  return [...new Set(tokenize(question))].filter((term) => inChunk.has(term));
}
