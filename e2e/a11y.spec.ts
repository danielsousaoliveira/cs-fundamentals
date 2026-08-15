import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automated accessibility checks.
 *
 * Worth being honest about what these are: axe catches roughly a third of WCAG
 * issues — the mechanical ones (contrast ratios, missing labels, broken ARIA,
 * heading order). It cannot tell you whether a visualisation is *comprehensible*
 * without sight, which for this site is the harder and more important question.
 *
 * So this file is the floor, not the ceiling. The parts that actually matter for
 * a step-through visualisation are covered deliberately elsewhere: every step
 * carries a prose caption (`motion.spec.ts`), the controls are reachable and
 * operable by keyboard (`widgets.spec.ts`), and role is encoded by border weight
 * as well as colour so the visuals survive greyscale.
 */

const PAGES = [
  '.',
  '1-complexity/big-o/',
  '2-data-structures/heaps/',
  '3-algorithms/sorting/',
  '5-systems/event-loop/',
  // Adds focusable SVG circles and build-time mermaid SVG — both are markup
  // axe has opinions about and neither exists anywhere else on the site.
  '10-ai-engineering/embeddings/',
  // The rendering-strategy timeline positions bars by inline style rather than
  // flow layout — worth checking axe has no opinion about that on its own.
  '11-web-frontend/rendering-strategies/',
];

for (const url of PAGES) {
  test(`no accessibility violations on ${url}`, async ({ page }) => {
    await page.goto(url);

    // Hydrate the islands first — the interesting markup (step controls,
    // counters, quiz radios) only exists after React attaches, so scanning the
    // static page would miss exactly the parts this site adds.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
    });
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0, { timeout: 20_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Report the actual rule and node, not just a count — a bare "3 violations"
    // is the kind of failure message that gets muted rather than fixed.
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes[0]?.html?.slice(0, 120)}`,
    );

    expect(summary, `accessibility violations:\n  ${summary.join('\n  ')}`).toEqual([]);
  });
}

test('the visualisation legend does not rely on colour alone', async ({ page }) => {
  await page.goto('3-algorithms/sorting/');

  // Wait for the widget's own island rather than all of them — the quizzes
  // further down the page are legitimately still un-hydrated.
  const island = page
    .locator('astro-island')
    .filter({ has: page.locator('.viz-frame') })
    .first();
  await page.locator('.viz-frame').first().scrollIntoViewIfNeeded();
  await expect(island).not.toHaveAttribute('ssr', /.*/, { timeout: 20_000 });

  // Each role must differ in border weight as well as colour, so the visuals
  // remain readable in greyscale and under every form of colour blindness.
  const borders = await page.locator('.viz-legend__swatch').evaluateAll((els) =>
    els.map((e) => ({
      role: e.getAttribute('data-role'),
      width: getComputedStyle(e).borderTopWidth,
      style: getComputedStyle(e).borderTopStyle,
    })),
  );

  expect(borders.length).toBeGreaterThan(2);
  // Not every role needs a unique weight, but they must not all be identical —
  // that would mean colour is the only channel carrying the meaning.
  const distinct = new Set(borders.map((b) => `${b.width}/${b.style}`));
  expect(distinct.size).toBeGreaterThan(1);
});
