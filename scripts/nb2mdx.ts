/**
 * Mechanical notebook → MDX conversion.
 *
 * This script is deliberately dumb. It moves content across and nothing more:
 * no rewriting, no summarising, no "improving" the prose. The rewrite-to-depth
 * pass is separate, human work done per page against the spine — and keeping the
 * two apart is what stops a half-converted page from looking finished.
 *
 * Output is always `status: 'stub'`, so every converted page ships with a banner
 * saying it has not been rewritten yet. The site can be public and honest at the
 * same time.
 *
 *   pnpm nb2mdx notebooks/2-data-structures/graphs.ipynb 2-data-structures
 *   pnpm nb2mdx --all
 */

import fs from 'node:fs';
import path from 'node:path';

interface NotebookCell {
  cell_type: 'markdown' | 'code' | 'raw';
  source: string[] | string;
  outputs?: {
    output_type: string;
    text?: string[] | string;
    data?: Record<string, unknown>;
  }[];
}

interface Notebook {
  cells: NotebookCell[];
}

const SPINE = [
  'Intuition',
  'Mechanics',
  'Complexity',
  'When NOT to use it',
  'Real-world usage',
  'Failure modes',
  'Practice problems',
  'Interview answers',
];

/** Notebook → target section directory. */
const DEFAULT_MAP: Record<string, string> = {
  '1-complexity': '1-complexity',
  '2-data-structures': '2-data-structures',
};

const text = (source: string[] | string): string =>
  Array.isArray(source) ? source.join('') : source;

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/** Demote headings by one level: the page title comes from frontmatter. */
function demoteHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,5})\s/gm, (_, hashes: string) => `${hashes}# `);
}

function convert(notebookPath: string, section: string, order: number): string {
  const notebook = JSON.parse(fs.readFileSync(notebookPath, 'utf8')) as Notebook;
  const slug = path.basename(notebookPath, '.ipynb');
  const title = titleFromSlug(slug);
  const body: string[] = [];

  for (const cell of notebook.cells) {
    const source = text(cell.source).trimEnd();
    if (!source) continue;

    if (cell.cell_type === 'markdown') {
      body.push(demoteHeadings(source));
      continue;
    }

    if (cell.cell_type !== 'code') continue;

    // Wrap in language tabs with an explicit TODO, so the missing TypeScript
    // port is visible on the page rather than silently absent.
    body.push(
      [
        '<Tabs syncKey="lang">',
        '<TabItem label="Python">',
        '',
        '```python',
        source,
        '```',
        '',
        '</TabItem>',
        '<TabItem label="TypeScript">',
        '',
        '```ts',
        '// TODO: port from the Python above.',
        '```',
        '',
        '</TabItem>',
        '</Tabs>',
      ].join('\n'),
    );

    const stdout = (cell.outputs ?? [])
      .filter((output) => output.output_type === 'stream' && output.text)
      .map((output) => text(output.text!))
      .join('');

    if (stdout.trim()) {
      body.push(
        ['```text title="recorded output"', stdout.trimEnd(), '```'].join('\n'),
      );
    }
  }

  const frontmatter = [
    '---',
    `title: ${title}`,
    'description: >-',
    `  TODO: one sentence a stranger could read cold and know whether this page is`,
    `  for them.`,
    'sidebar:',
    `  order: ${order}`,
    'difficulty: core',
    'status: stub',
    'prereqs: []',
    'tags: []',
    'languages: [python]',
    'sources:',
    `  - ${notebookPath}`,
    '---',
    '',
    "import { Tabs, TabItem } from '@astrojs/starlight/components';",
  ].join('\n');

  const spineStubs = SPINE.map(
    (heading) =>
      `## ${heading}\n\n{/* TODO: see src/content/_template.mdx for what belongs here. */}`,
  ).join('\n\n');

  return [
    frontmatter,
    '',
    '{/* Converted mechanically from the notebook. Everything below the original',
    '    material still needs the rewrite-to-depth pass. */}',
    '',
    body.join('\n\n'),
    '',
    '---',
    '',
    spineStubs,
    '',
  ].join('\n');
}

function outputPath(notebookPath: string, section: string): string {
  const slug = path.basename(notebookPath, '.ipynb');
  return path.join(process.cwd(), 'src/content/docs', section, `${slug}.mdx`);
}

function findNotebooks(): string[] {
  const root = path.resolve(process.cwd(), 'notebooks');
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      fs
        .readdirSync(path.join(root, dir.name))
        .filter((file) => file.endsWith('.ipynb'))
        .map((file) => path.join('notebooks', dir.name, file)),
    );
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(
    'Usage:\n' +
      '  pnpm nb2mdx <notebook.ipynb> <section-dir> [order]\n' +
      '  pnpm nb2mdx --all\n',
  );
  process.exit(1);
}

const targets: { notebook: string; section: string; order: number }[] = [];

if (args[0] === '--all') {
  const byDir = new Map<string, number>();
  for (const notebook of findNotebooks()) {
    const dir = path.basename(path.dirname(notebook));
    const section = DEFAULT_MAP[dir];
    if (!section) {
      console.warn(`Skipping ${notebook}: no section mapping for "${dir}".`);
      continue;
    }
    const order = (byDir.get(section) ?? 0) + 1;
    byDir.set(section, order);
    targets.push({ notebook, section, order });
  }
} else {
  targets.push({
    notebook: args[0]!,
    section: args[1] ?? '2-data-structures',
    order: Number(args[2] ?? 1),
  });
}

for (const { notebook, section, order } of targets) {
  const destination = outputPath(notebook, section);

  // Never clobber a page that has been rewritten — that is hours of work the
  // conversion script has no business overwriting.
  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(destination, 'utf8');
    if (!/^status:\s*['"]?stub/m.test(existing)) {
      console.warn(
        `Skipping ${path.relative(process.cwd(), destination)}: already exists ` +
          `and is not a stub. Delete it first if you really mean to regenerate.`,
      );
      continue;
    }
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, convert(notebook, section, order));
  console.log(`${notebook} → ${path.relative(process.cwd(), destination)}`);
}
