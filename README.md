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

**Sections 7–13 use one substitution:** `## Complexity` becomes `## Cost &
limits`. Asking a Terraform or CosmosDB page for a complexity class produces
either a stretch or a lie; the derivation is still required, it just lands in
RU/s, dollars per TB egressed, or p99 at a given pool size. Everything else —
including both non-negotiable headings, byte for byte — is identical. The
mapping lives in `scripts/lint-spine.ts`, and an unmapped section falls back to
the stricter algorithmic spine so a new directory fails loudly rather than
accepting a page with neither analysis.

## Adding a topic

**One new `.mdx` file.** Copy the right template into the right section
directory under `src/content/docs/`:

| Template | For |
|---|---|
| `src/content/_template.mdx` | sections 1–6 — complexity, data structures, algorithms, paradigms, systems, languages |
| `src/content/_template-engineering.mdx` | sections 7–13 — data, databases, cloud, AI, frontend, backend, architecture |

The sidebar, the section index page, and full-text search all pick it up on the
next build. No registration step anywhere.

A whole new section is one new directory plus a `_section.json`.

### Diagrams

Write a ` ```mermaid ` fence anywhere in a page. `rehype-mermaid` renders it to
inline SVG at build time, so a page with six diagrams still ships zero runtime
JavaScript — the same trade KaTeX makes for the maths.

Two consequences worth knowing before you rely on it. The build needs a browser
(`pnpm exec playwright install chromium`; CI does this in both workflows), and
mermaid derives its shades from literal colours, so the palette cannot be
theme-aware at render time. The build renders the dark palette and
`viz.css` repaints it for light mode — the two halves are a pair, and changing
one without the other gives a diagram nobody can read in one of the themes.

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
pnpm test:e2e         # Playwright: hydration, base paths, a11y (needs a build)
pnpm nb2mdx --all     # mechanical notebook → MDX conversion (emits stubs)
pnpm og:image         # regenerate public/og.png after changing its design
```

### One dev-server caveat

Adding a new `.mdx` to a section that **already has pages** is picked up live —
nav, search and the section index all update with no restart, which is the
behaviour the whole content model is designed around.

The exception: the sidebar's section list is enumerated when
`astro.config.mjs` loads, so a dev server that was started when a section was
still **empty** keeps showing that section as empty even after you add pages to
it. Restart `pnpm dev` and it comes back. It only bites once per new section,
and never affects `pnpm build`, which enumerates from scratch every time.

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
