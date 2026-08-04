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

interface Section {
  name: string;
  match: RegExp;
}

/**
 * Heading text (lowercased, punctuation-insensitive) required on every complete
 * page. The algorithmic spine — data structures, algorithms, paradigms.
 */
const ALGORITHMIC: Section[] = [
  { name: 'Intuition', match: /^intuition/ },
  { name: 'Mechanics', match: /^mechanics/ },
  { name: 'Complexity', match: /^complexity/ },
  { name: 'When NOT to use it', match: /^when not to use/ },
  { name: 'Real-world usage', match: /^real[- ]world/ },
  { name: 'Failure modes', match: /^failure modes/ },
  { name: 'Practice problems', match: /^practice/ },
  { name: 'Interview answers', match: /^interview/ },
];

/**
 * The engineering spine — cloud, data, AI, web. Exactly one substitution:
 * "Complexity" becomes "Cost & limits".
 *
 * The substitution is a change of units, not a relaxation. "Derive it, never
 * assert it" still holds; on a Terraform or CosmosDB page the derivation lands
 * in RU/s, dollars per TB egressed, or p99 at a given pool size rather than in
 * $O(\log n)$. Asking those pages for a complexity class would have produced
 * either a stretch or a lie, and the honest alternative to a stretched heading
 * is a different heading.
 *
 * Note what is byte-identical between the two lists: "When NOT to use it" and
 * "Failure modes". They are the reason the project exists, and keeping them
 * duplicated across two explicit arrays — rather than loosening the rule to a
 * smaller shared core — is what stops a future variant quietly dropping one.
 */
const ENGINEERING: Section[] = [
  { name: 'Intuition', match: /^intuition/ },
  { name: 'Mechanics', match: /^mechanics/ },
  { name: 'Cost & limits', match: /^cost/ },
  { name: 'When NOT to use it', match: /^when not to use/ },
  { name: 'Real-world usage', match: /^real[- ]world/ },
  { name: 'Failure modes', match: /^failure modes/ },
  { name: 'Practice problems', match: /^practice/ },
  { name: 'Interview answers', match: /^interview/ },
];

/**
 * Which spine each section directory answers to.
 *
 * Unlisted directories fall back to ALGORITHMIC — the stricter of the two, so a
 * new section added without a decision here fails loudly rather than silently
 * accepting a page with no cost analysis *and* no complexity analysis.
 */
const VARIANTS: Record<string, Section[]> = {
  '1-complexity': ALGORITHMIC,
  '2-data-structures': ALGORITHMIC,
  '3-algorithms': ALGORITHMIC,
  '4-paradigms': ALGORITHMIC,
  '5-systems': ALGORITHMIC,
  '6-languages': ALGORITHMIC,
  '7-data-engineering': ENGINEERING,
  '8-databases-storage': ENGINEERING,
  '9-cloud-infra': ENGINEERING,
  '10-ai-engineering': ENGINEERING,
  '11-web-frontend': ENGINEERING,
  '12-backend-apis': ENGINEERING,
  '13-architecture': ENGINEERING,
};

/** The top-level section directory a page lives in, e.g. `10-ai-engineering`. */
function sectionOf(file: string): string {
  return path.relative(DOCS, file).split(path.sep)[0] ?? '';
}

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

  for (const section of VARIANTS[sectionOf(file)] ?? ALGORITHMIC) {
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
