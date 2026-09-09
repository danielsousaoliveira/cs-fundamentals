# Contributing

Thanks for wanting to help. The most common and most welcome contribution is a
**content correction** — a bound that is wrong, a derivation that skips a step,
a failure mode that is misstated. File it with the "Content correction" issue
template and, if you can, open a PR.

## The bar

This site holds a specific line, and it is worth knowing before you start so you
do not discover it in review:

- **Every claim is measured, not remembered.** A complexity bound is derived on
  the page, not asserted. A performance number comes from a run you can point
  to, not from memory. "It's O(log n)" without the argument will be sent back.
- **Every complete page carries the full spine**, in order:

  ```
  intuition → visual → mechanics → complexity (derived, never asserted)
  → when NOT to use it → real-world usage → failure modes
  → practice problems → interview answers
  ```

  "When NOT to use it" and "Failure modes" are the two most treatments skip.
  They are non-negotiable here — `pnpm lint:spine` fails CI without them.

- **Prose is written for a stranger reading cold**: a claim, the smallest code
  that proves it, the failure it causes in production, then the caveat that
  stops it sounding dogmatic.

## Proposing a new page

One new `.mdx` file. Copy the right template into the right section directory
under `src/content/docs/` — do not describe the structure from scratch, the
templates are the source of truth:

| Template | Sections |
|---|---|
| `src/content/_template.mdx` | 1–6 — complexity, data structures, algorithms, paradigms, systems, languages |
| `src/content/_template-engineering.mdx` | 7–14 — data engineering, databases, cloud, AI, frontend, backend, architecture, production |

The engineering template renames `## Complexity` to `## Cost & limits`: the
derivation still happens, it just lands in RU/s, dollars per TB, or p99 latency
instead of Big-O. Everything else is identical.

The sidebar, section index, and search pick the file up on the next build. There
is no registration step.

A whole new section is one new directory plus a `_section.json`. An unmapped
section directory falls back to the stricter algorithmic spine, so a new
directory fails loudly rather than skipping the check.

## How your change is checked before merge

CI runs the same commands you can run locally. A PR merges when they pass and a
maintainer has reviewed the content against the bar above.

| Command | What it enforces |
|---|---|
| `pnpm check` | Astro types across `.astro`/`.ts`/`.tsx` and content-collection frontmatter |
| `pnpm test` | Trace generators agree with the algorithms they visualise; widget behaviour |
| `pnpm lint:spine` | Every `status: complete` page carries the full spine |
| `pnpm lint` | Prettier formatting (`pnpm format` to fix) |
| `pnpm test:e2e` | Playwright: hydration, base paths, accessibility (needs a build) |

## Reporting a security problem

Do not open a public issue for a security concern. See `SECURITY.md`.

## Code of conduct

Participation is covered by `CODE_OF_CONDUCT.md`.
