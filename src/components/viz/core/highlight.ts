/**
 * A deliberately tiny syntax tokeniser for CodePane.
 *
 * Shiki does the real highlighting for prose code blocks, at build time, with
 * zero client JS. But a widget's code pane re-renders as the reader switches
 * language and steps through the trace, so it needs highlighting at runtime —
 * and shipping Shiki's grammars to the browser to colour twenty lines of Python
 * would cost more than the entire rest of the page.
 *
 * So: five token classes, two languages, no dependency. It is not a parser and
 * it will mis-colour pathological input; the code shown in widgets is short and
 * chosen, which is what makes that trade acceptable.
 */

export type Lang = 'python' | 'typescript';

const KEYWORDS: Record<Lang, string[]> = {
  python: [
    'def',
    'return',
    'if',
    'elif',
    'else',
    'while',
    'for',
    'in',
    'not',
    'and',
    'or',
    'None',
    'True',
    'False',
    'class',
    'import',
    'from',
    'as',
    'yield',
    'break',
    'continue',
    'pass',
    'lambda',
    'with',
    'try',
    'except',
    'raise',
  ],
  typescript: [
    'function',
    'return',
    'if',
    'else',
    'while',
    'for',
    'of',
    'in',
    'const',
    'let',
    'var',
    'class',
    'new',
    'null',
    'undefined',
    'true',
    'false',
    'import',
    'from',
    'export',
    'type',
    'interface',
    'break',
    'continue',
    'throw',
    'try',
    'catch',
    'this',
    'number',
    'string',
    'boolean',
    'void',
  ],
};

export interface Token {
  text: string;
  kind: 'keyword' | 'number' | 'string' | 'comment' | 'plain';
}

const TOKEN_PATTERN =
  /(#[^\n]*|\/\/[^\n]*)|('[^']*'|"[^"]*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)|(\s+|[^\w\s])/g;

export function tokenize(line: string, lang: Lang): Token[] {
  const keywords = new Set(KEYWORDS[lang]);
  const tokens: Token[] = [];

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const [text, comment, string, number, word] = match;

    if (comment) tokens.push({ text, kind: 'comment' });
    else if (string) tokens.push({ text, kind: 'string' });
    else if (number) tokens.push({ text, kind: 'number' });
    else if (word) {
      tokens.push({ text, kind: keywords.has(word) ? 'keyword' : 'plain' });
    } else tokens.push({ text, kind: 'plain' });
  }

  return tokens;
}

/** Is this 1-indexed line inside the step's highlight range? */
export function isHighlighted(
  lineNumber: number,
  highlight: number | [number, number] | undefined,
): boolean {
  if (highlight === undefined) return false;
  if (typeof highlight === 'number') return lineNumber === highlight;
  return lineNumber >= highlight[0] && lineNumber <= highlight[1];
}
