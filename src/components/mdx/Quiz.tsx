import { useEffect, useId, useState, type ReactNode } from 'react';

export interface QuizOption {
  label: string;
  correct?: boolean;
}

interface QuizProps {
  question: string;
  /** `output` for "what does this print", `complexity` for "what's the bound". */
  kind?: 'output' | 'complexity' | 'concept';
  /** Code shown above the options. */
  snippet?: string;
  lang?: 'python' | 'typescript' | 'javascript';
  options: QuizOption[];
  /** Shown after answering, right or wrong. This is where the teaching happens. */
  explanation: ReactNode;
  /** Stable key for remembering that this quiz was answered. */
  id: string;
}

const KIND_LABEL: Record<string, string> = {
  output: 'Predict the output',
  complexity: 'Predict the complexity',
  concept: 'Check yourself',
};

/**
 * The site's entire gamification surface.
 *
 * Self-testing before being shown the answer is the highest-leverage cheap thing
 * a written explanation can do — the retrieval attempt is what makes the
 * explanation stick, whether or not the attempt succeeds. So the explanation is
 * revealed on answering either way, and nothing is scored.
 *
 * No XP, no streaks, no leaderboard. `localStorage` stores one bit per quiz —
 * "you have answered this" — so a re-read doesn't re-hide what you already
 * worked out. The component is fully functional with storage unavailable.
 */
export function Quiz({
  question,
  kind = 'concept',
  snippet,
  lang = 'python',
  options,
  explanation,
  id,
}: QuizProps) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const groupName = useId();
  const storageKey = `quiz:${id}`;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === 'answered') setSeen(true);
    } catch {
      // Private browsing, storage disabled — the quiz still works, it just forgets.
    }
  }, [storageKey]);

  const answered = chosen !== null;
  const revealed = answered || seen;

  function choose(index: number) {
    setChosen(index);
    try {
      window.localStorage.setItem(storageKey, 'answered');
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="quiz" data-pagefind-ignore>
      <p className="quiz__kind">{KIND_LABEL[kind]}</p>
      <p className="quiz__question">{question}</p>

      {snippet && (
        <pre className="quiz__snippet">
          <code data-lang={lang}>{snippet.replace(/\n$/, '')}</code>
        </pre>
      )}

      <ul className="quiz__options">
        {options.map((option, i) => {
          const state = !answered
            ? undefined
            : option.correct
              ? 'correct'
              : i === chosen
                ? 'wrong'
                : undefined;

          return (
            <li key={option.label}>
              <label className="quiz__option" data-state={state}>
                <input
                  type="radio"
                  name={groupName}
                  disabled={answered}
                  onChange={() => choose(i)}
                />
                <code>{option.label}</code>
                {state === 'correct' && <span aria-label="correct"> ✓</span>}
                {state === 'wrong' && <span aria-label="incorrect"> ✗</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {revealed ? (
        <div className="quiz__explanation">{explanation}</div>
      ) : (
        seen && (
          <button type="button" className="viz-btn" onClick={() => setSeen(true)}>
            show the explanation
          </button>
        )
      )}
    </section>
  );
}
