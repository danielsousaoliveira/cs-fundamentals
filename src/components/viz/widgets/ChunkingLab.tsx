import { useMemo, useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  ANSWER_SENTENCE,
  QUESTIONS,
  overlapTerms,
  retrieve,
  words,
  DOCUMENT,
  type Strategy,
} from '../traces/chunking.ts';

/**
 * The chunking page's centrepiece.
 *
 * It exists to demonstrate one counter-intuitive fact that prose consistently
 * fails to land: **whether retrieval works is not monotonic in chunk size.**
 * On this document, 22 words works, 24 splits the answer, 26-28 work, 30-32
 * split, 34-44 work, 46-50 split. Increasing the chunk size can break retrieval
 * that was working, because boundary alignment has nothing to do with content.
 *
 * That is why the "answer intact" indicator is the widget's primary output
 * rather than the similarity score. A reader dragging the size slider watches it
 * flip on and off, and the lesson — that overlap converts a lottery into
 * near-certainty — arrives without being asserted.
 *
 * Everything is computed by `traces/chunking.ts` from the document on screen,
 * using the same TF-IDF machinery as the embeddings page.
 */
export function ChunkingLab() {
  const [question, setQuestion] = useState(QUESTIONS[0]!);
  const [size, setSize] = useState(24);
  const [overlap, setOverlap] = useState(0);
  const [strategy, setStrategy] = useState<Strategy>('fixed');

  const result = useMemo(
    () => retrieve(question, { size, overlap, strategy }),
    [question, size, overlap, strategy],
  );

  const total = words(DOCUMENT).length;
  const top = result.ranked[0]!;
  const isDefaultQuestion = question === QUESTIONS[0];

  return (
    <VizFrame
      title="Chunk a real document and watch retrieval succeed or fail"
      intro="Every score is computed from the document below. The indicator tracks whether the sentence answering the question survives inside a single chunk."
      caption={
        !isDefaultQuestion
          ? `Top chunk scores ${top.score.toFixed(3)}, matching on: ${overlapTerms(question, top.chunk).join(', ') || 'nothing'}.`
          : result.answerIntact
            ? `The answer sentence is intact inside chunk ${result.ranked.find((r) => r.rank === result.answerRank)!.chunk.index}, ranked #${result.answerRank}.`
            : 'The answer sentence is split across a chunk boundary. No chunk contains it, so no ranking can retrieve it.'
      }
    >
      <div className="chunk__controls">
        <label>
          <span>question</span>
          <select
            className="viz-select"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          >
            {QUESTIONS.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>strategy</span>
          <select
            className="viz-select"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
          >
            <option value="fixed">fixed size</option>
            <option value="sentence">sentence boundaries</option>
          </select>
        </label>

        <label>
          <span>
            chunk size <strong>{size}</strong> words
          </span>
          <input
            type="range"
            min={10}
            max={120}
            step={2}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>

        <label>
          <span>
            overlap <strong>{overlap}</strong> words
            {strategy === 'sentence' && <em> (n/a)</em>}
          </span>
          <input
            type="range"
            min={0}
            max={40}
            step={2}
            value={overlap}
            disabled={strategy === 'sentence'}
            onChange={(e) => setOverlap(Number(e.target.value))}
          />
        </label>
      </div>

      {isDefaultQuestion && (
        <p
          className={`chunk__verdict chunk__verdict--${result.answerIntact ? 'ok' : 'bad'}`}
          role="status"
        >
          {result.answerIntact
            ? '✓ answer sentence intact in one chunk'
            : '✗ answer sentence split across chunks — unretrievable at any k'}
        </p>
      )}

      <ol className="chunk__list">
        {result.chunks.map((chunk) => {
          const entry = result.ranked.find((r) => r.chunk.id === chunk.id)!;
          const holdsAnswer = chunk.text
            .replace(/\s+/g, ' ')
            .toLowerCase()
            .includes(ANSWER_SENTENCE.toLowerCase());
          return (
            <li
              key={chunk.id}
              className={[
                'chunk__item',
                entry.rank === 1 ? 'chunk__item--top' : '',
                holdsAnswer ? 'chunk__item--answer' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="chunk__meta">
                <span className="chunk__rank">#{entry.rank}</span>
                <span className="chunk__score">{entry.score.toFixed(3)}</span>
              </span>
              <span className="chunk__text">{chunk.text}</span>
            </li>
          );
        })}
      </ol>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>chunks</dt>
          <dd>
            <span className="viz-counters__value">{result.chunks.length}</span>
            <span className="viz-counters__expected"> from {total} words</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>vectors stored</dt>
          <dd>
            <span className="viz-counters__value">{result.chunks.length}</span>
            <span className="viz-counters__expected">
              {' '}
              {overlap > 0 && strategy === 'fixed'
                ? `— overlap costs ${Math.round((result.chunks.length / Math.ceil(total / size) - 1) * 100)}% more`
                : '— no overlap cost'}
            </span>
          </dd>
        </div>
      </dl>
    </VizFrame>
  );
}
