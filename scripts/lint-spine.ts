/**
 * Enforce the page spine.
 *
 * Every page on this site follows a fixed structure. Two of its sections —
 * "When NOT to use it" and "Failure modes" — are the entire reason the project
 * exists: they are exactly what the original notebooks lacked, and they are the
 * first thing to get quietly dropped when a page is being finished in a hurry.
 *
 * Discipline does not survive contact with a deadline. A lint rule does.
 *
 * Only pages marked `status: complete` are checked; stubs and drafts are
 * expected to be incomplete and say so on the page itself.
 */

import fs from 'node:fs';
import path from 'node:path';

const DOCS = path.resolve(process.cwd(), 'src/content/docs');

/** Heading text (lowercased, punctuation-insensitive) required on every complete page. */
const REQUIRED = [
  { name: 'Intuition', match: /^intuition/ },
  { name: 'Mechanics', match: /^mechanics/ },
  { name: 'Complexity', match: /^complexity/ },
  { name: 'When NOT to use it', match: /^when not to use/ },
  { name: 'Real-world usage', match: /^real[- ]world/ },
  { name: 'Failure modes', match: /^failure modes/ },
  { name: 'Practice problems', match: /^practice/ },
  { name: 'Interview answers', match: /^interview/ },
];

interface Problem {
  file: string;
  message: string;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.mdx') || entry.name.endsWith('.md') ? [full] : [];
  });
}

function frontmatterStatus(source: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return undefined;
  return /^status:\s*['"]?(\w+)['"]?/m.exec(match[1]!)?.[1];
}

function headings(source: string): string[] {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  // Ignore headings inside fenced code blocks, where `#` is a Python comment.
  const withoutFences = body.replace(/^```[\s\S]*?^```/gm, '');
  return [...withoutFences.matchAll(/^##\s+(.+)$/gm)].map((m) =>
    m[1]!.trim().toLowerCase().replace(/[*_`]/g, ''),
  );
}

const problems: Problem[] = [];
let checked = 0;

for (const file of walk(DOCS)) {
  const source = fs.readFileSync(file, 'utf8');
  if (frontmatterStatus(source) !== 'complete') continue;

  // The landing page is a splash, not a topic page.
  if (path.basename(file) === 'index.mdx' && path.dirname(file) === DOCS) continue;

  checked++;
  const found = headings(source);
  const relative = path.relative(process.cwd(), file);

  for (const section of REQUIRED) {
    if (!found.some((heading) => section.match.test(heading))) {
      problems.push({
        file: relative,
        message: `marked "complete" but has no "## ${section.name}" section`,
      });
    }
  }
}

if (problems.length > 0) {
  console.error(`\nSpine check failed — ${problems.length} problem(s):\n`);
  for (const problem of problems) {
    console.error(`  ${problem.file}\n    ${problem.message}`);
  }
  console.error(
    `\nEither add the missing sections, or set the page's status to "draft"\n` +
      `so it ships with a banner saying it is unfinished.\n`,
  );
  process.exit(1);
}

console.log(`Spine check passed — ${checked} complete page(s) carry the full spine.`);
