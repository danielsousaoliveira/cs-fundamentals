<!--
Keep this readable in a minute. Delete sections that do not apply.
-->

## What changed

## Why

## How to test

## Checklist

- [ ] `pnpm check` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint:spine` passes (every `status: complete` page carries the full spine)
- [ ] `pnpm lint` passes (`pnpm format` to fix)
- [ ] `pnpm test:e2e` passes, or this change cannot affect hydration, base paths, or a11y
- [ ] New or changed pages follow the template for their section (`src/content/_template.mdx` or `_template-engineering.mdx`)
- [ ] Every complexity / cost claim is derived on the page, not asserted
- [ ] Performance numbers point to a run, not to memory
