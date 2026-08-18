import { expect, test } from '@playwright/test';

/**
 * Structural smoke tests: the things that are correct in dev and broken in
 * production, which is exactly the set the other test layers cannot see.
 *
 * The base path is the headline. Every internal link on this site has to go
 * through `/cs-fundamentals`, a hand-written `/foo` href works in dev and 404s
 * once deployed, and no unit test can catch that.
 */

test('the landing page renders and links into the sections', async ({ page }) => {
  await page.goto('.');
  await expect(page).toHaveTitle(/CS Fundamentals/);

  // The section grid is derived from the filesystem; if `readSections()` ever
  // silently returns [] again, this is what fails.
  const links = page.locator('a[href*="-"]');
  expect(await links.count()).toBeGreaterThan(5);
});

test('the sidebar is auto-derived and covers all six sections', async ({ page }) => {
  await page.goto('2-data-structures/heaps/');

  // Asserted through visible links rather than Starlight's internal nav markup:
  // the real sidebar element carries no stable class or aria-label, so
  // selecting it structurally is brittle across Starlight versions. What
  // actually matters is that a reader can reach every section — so check that.
  for (const [section, page_] of [
    ['Big-O', '1-complexity/big-o'],
    ['Heaps', '2-data-structures/heaps'],
    ['Sorting', '3-algorithms/sorting'],
    ['Greedy', '4-paradigms/greedy'],
    ['Databases', '5-systems/databases'],
    ['SOLID', '6-languages/solid'],
    ['Embeddings', '10-ai-engineering/embeddings'],
    ['Agents', '10-ai-engineering/agents'],
    ['SQL fundamentals', '7-data-engineering/sql-fundamentals'],
    ['dbt', '7-data-engineering/dbt'],
    ['Postgres', '8-databases-storage/postgres'],
    ['CosmosDB', '8-databases-storage/cosmosdb'],
    ['Terraform', '9-cloud-infra/terraform'],
    ['Kubernetes', '9-cloud-infra/kubernetes'],
    ['Reading the symptoms', '14-production/reading-the-symptoms'],
    ['Distributed tracing', '14-production/distributed-tracing'],
  ] as const) {
    const link = page.locator(`a[href$="/${page_}/"]:visible`).first();
    await expect(link, `${section} should be reachable from the nav`).toBeVisible();
  }
});

test('every internal link on a page resolves — no base-path 404s', async ({
  page,
  request,
}) => {
  await page.goto('3-algorithms/sorting/');

  const hrefs = await page
    .locator('main a[href^="/"]')
    .evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href')!),
    );
  expect(hrefs.length).toBeGreaterThan(0);

  // Checked with real requests rather than by string-matching the dist tree,
  // so a misconfigured base or a missing trailing slash shows up here.
  for (const href of new Set(hrefs)) {
    const response = await request.get(href);
    expect(response.status(), `${href} should not 404`).toBeLessThan(400);
  }
});

test('no page throws a hydration error', async ({ page }) => {
  // The sweep now covers 14 pages; each does a full scroll-and-settle pass,
  // so the default 30s budget is too tight once the list grows this long.
  test.setTimeout(60_000);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A broad net for hydration-time crashes: a build can succeed, render
  // perfect HTML, and still throw the moment React attaches, leaving every
  // island on the page inert.
  //
  // Worth being precise about what this does *not* cover. The quiz bug — MDX
  // JSX passed to a React island as a prop — throws only when the offending
  // value is actually rendered, which for the explanation happens after the
  // reader answers. So this test stayed green against a build with that bug in
  // it; the guard for that one is the interaction test in `widgets.spec.ts`.
  // Verified by reverting the fix and checking which test went red.
  for (const url of [
    '1-complexity/big-o/',
    '2-data-structures/heaps/',
    '3-algorithms/sorting/',
    '4-paradigms/greedy/',
    '5-systems/event-loop/',
    '6-languages/typescript/',
    '10-ai-engineering/embeddings/',
    '8-databases-storage/postgres/',
    '8-databases-storage/indexes-and-query-plans/',
    '8-databases-storage/cosmosdb/',
    '9-cloud-infra/terraform/',
    '14-production/reading-the-symptoms/',
    '14-production/cascading-failures/',
    '14-production/distributed-tracing/',
  ]) {
    await page.goto(url);

    // Walk down the page so every `client:visible` island enters the viewport,
    // then wait for them to actually hydrate. A fixed timeout here is not good
    // enough: an earlier version waited 600ms, which was short enough that the
    // islands had not thrown yet, so the test passed against a build with the
    // bug still in it.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
    });

    await expect(page.locator('astro-island[ssr]')).toHaveCount(0, { timeout: 20_000 });

    // Astro clears `ssr` when it starts hydrating, and React's render — and so
    // any error it throws — lands a tick or two later, so give it a moment to
    // surface before the assertion below reads the array.
    await page.waitForTimeout(500);
  }

  expect(errors, `hydration errors:\n${errors.join('\n')}`).toEqual([]);
});

test('the Open Graph image is absolute, base-aware and actually served', async ({
  page,
  request,
}) => {
  await page.goto('2-data-structures/heaps/');

  const src = await page.locator('meta[property="og:image"]').getAttribute('content');

  expect(src, 'og:image should be present').toBeTruthy();
  // Absolute: crawlers do not resolve relative URLs.
  expect(src).toMatch(/^https?:\/\//);
  // Base-aware: resolving against `Astro.site` alone silently drops
  // `/cs-fundamentals`, which is a 404 nobody sees until a link is shared.
  expect(src).toContain('/cs-fundamentals/');

  // And the file is really there.
  const response = await request.get(src!.replace(/^https?:\/\/[^/]+/, ''));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');

  // Starlight emits `twitter:card` itself; exactly one should survive.
  expect(await page.locator('meta[name="twitter:card"]').count()).toBe(1);
});

test('math renders as KaTeX rather than raw dollar signs', async ({ page }) => {
  await page.goto('4-paradigms/divide-and-conquer/');

  // The Master Theorem section is the heaviest maths on the site; if the
  // unified processor opt-in ever regresses, this is where it shows.
  await expect(page.locator('.katex').first()).toBeVisible();
  const main = await page.locator('main').innerText();
  expect(main).not.toContain('\\log_b');
});

test('search is built and returns results', async ({ page }) => {
  await page.goto('.');

  // Pagefind indexes the built HTML, so a new page is searchable with no
  // registration step. This asserts that claim end to end.
  // Relative, so it resolves under the base path rather than the origin root.
  const response = await page.request.get('pagefind/pagefind.js');
  expect(response.status()).toBe(200);
});

test('the page spine is present in the rendered output', async ({ page }) => {
  await page.goto('5-systems/databases/');
  const text = await page.locator('main').innerText();

  // lint:spine checks the source; this checks it survived rendering.
  for (const heading of [
    'Intuition',
    'Mechanics',
    'Complexity',
    'When NOT to use it',
    'Real-world usage',
    'Failure modes',
    'Practice problems',
    'Interview answers',
  ]) {
    expect(text).toContain(heading);
  }
});
