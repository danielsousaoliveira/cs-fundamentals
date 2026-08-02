# CS Fundamentals

An in-depth, visual introduction to computer science, published at
**https://danielsousaoliveira.github.io/cs-fundamentals/**.

Most explanations of a data structure give you a definition, a library demo, three
practice problems, and the sentence "insertion is O(log n)". You finish knowing
what the thing is called and nothing about when it will hurt you. This site is an
attempt at the opposite: every bound derived, every structure shown working, and
every failure mode named.

## The page spine

Every topic page follows the same structure, and `pnpm lint:spine` fails CI if a
page marked `status: complete` is missing any of it:

```
intuition → visual → mechanics → complexity (derived, never asserted)
→ when NOT to use it → real-world usage → failure modes
→ practice problems → interview answers
```

"When NOT to use it" and "Failure modes" are the two usually missing elsewhere.
They are non-negotiable here, which is why a lint rule enforces them rather than
good intentions.

## Adding a topic

**One new `.mdx` file.** Copy `src/content/_template.mdx` into the right section
directory under `src/content/docs/`, and the sidebar, the section index page, and
full-text search all pick it up on the next build. No registration step anywhere.

A whole new section is one new directory plus a `_section.json`.

## Layout

```
src/
  content/docs/<n>-<section>/   content, one .mdx per topic
  components/viz/core/          the shared viz primitive library
  components/viz/widgets/       per-concept widgets, composed from core
  components/viz/traces/        pure step generators + their tests
  lib/sections.ts               filesystem → sidebar and index data
  pages/[section]/index.astro   auto-generated section index pages
notebooks/                      the original Jupyter notebooks, still runnable
scripts/                        notebook → MDX conversion, spine linter
```

### Visualisations

A widget is **a pure trace generator plus a renderer**. The algorithm runs once,
ahead of time, producing an array of immutable snapshots; the player moves an
index and the renderer diffs. Scrubbing, stepping backwards, and reduced-motion
support all fall out of that for free — and, more importantly, a trace is a value
you can assert on in a test.

That last part is the rule that matters: **a visualisation that disagrees with the
algorithm it claims to show is worse than no visualisation.** So the tests check
that traces end in valid states and that the on-screen comparison counters match
independently-derived bounds.

`/viz-gallery` (dev only) shows every primitive in every role on one page. If two
of them stop looking like the same design system, fix it there rather than
working around it on a content page.

## Commands

```bash
pnpm install
pnpm dev              # http://localhost:4321/cs-fundamentals/
pnpm build            # static site into dist/
pnpm test             # trace generators + widget behaviour
pnpm check            # types, across .astro/.ts/.tsx and frontmatter
pnpm lint:spine       # every `complete` page carries the full spine
pnpm nb2mdx --all     # mechanical notebook → MDX conversion (emits stubs)
```

## Notebooks

The original notebooks live in `notebooks/` and stay runnable — they are for
experimenting; the site is for learning. They need only the standard library:

```bash
python3 -m venv venv && . venv/bin/activate
pip install -r notebooks/requirements.txt
```

## Deployment

Pushing to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml`. The site is served from `/cs-fundamentals`, so
internal links must go through Astro's `base` — a hand-written `/foo` href works
in dev and 404s in production.
