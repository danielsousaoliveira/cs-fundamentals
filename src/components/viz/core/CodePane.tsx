import { useEffect, useRef } from 'react';
import { isHighlighted, tokenize, type Lang } from './highlight.ts';

interface CodePaneProps {
  /** Source per language. The reader's language choice picks between them. */
  code: Partial<Record<Lang, string>>;
  lang: Lang;
  onLangChange?: (lang: Lang) => void;
  /** 1-indexed line, or inclusive range, driven by the current step. */
  highlight?: number | [number, number];
  label?: string;
}

/**
 * Source code with the currently-executing line highlighted.
 *
 * The sync between step and line is the point: it answers "where am I in the
 * algorithm?" without the reader having to hold the mapping in their head, which
 * is precisely the moment most explanations lose people.
 */
export function CodePane({
  code,
  lang,
  onLangChange,
  highlight,
  label,
}: CodePaneProps) {
  const available = (Object.keys(code) as Lang[]).filter((l) => code[l]);
  const active = code[lang] ? lang : available[0];
  const source = active ? code[active] : undefined;
  const lines = source?.replace(/\n$/, '').split('\n') ?? [];

  const activeLineRef = useRef<HTMLSpanElement>(null);

  // Keep the highlighted line in view when a long function scrolls inside the pane.
  useEffect(() => {
    // Feature-detected: jsdom (and some older browsers) have no scrollIntoView,
    // and this is a convenience, not something worth throwing over.
    activeLineRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight]);

  if (!source || !active) return null;

  return (
    <div className="viz-code">
      <div className="viz-code__header">
        {label && <span className="viz-code__label">{label}</span>}
        {available.length > 1 && (
          <div className="viz-code__langs" role="tablist" aria-label="Language">
            {available.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={option === active}
                className="viz-code__lang"
                data-selected={option === active || undefined}
                onClick={() => onLangChange?.(option)}
              >
                {option === 'python' ? 'Python' : 'TypeScript'}
              </button>
            ))}
          </div>
        )}
      </div>

      <pre className="viz-code__pre">
        <code>
          {lines.map((line, i) => {
            const lineNumber = i + 1;
            const on = isHighlighted(lineNumber, highlight);
            return (
              <span
                key={lineNumber}
                ref={on ? activeLineRef : undefined}
                className="viz-code__line"
                data-active={on || undefined}
              >
                <span className="viz-code__gutter">{lineNumber}</span>
                <span className="viz-code__text">
                  {tokenize(line, active).map((token, j) => (
                    <span key={j} data-tok={token.kind}>
                      {token.text}
                    </span>
                  ))}
                  {line === '' ? ' ' : ''}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
