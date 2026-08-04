import { expect, test } from '@playwright/test';

/**
 * Emulation is set here rather than through a project's `use: { reducedMotion }`
 * because the latter silently does not apply — the media query still reports
 * false, so the suite would assert against normal-motion rendering and pass for
 * the wrong reason. The first test below verifies the emulation itself, so this
 * cannot regress unnoticed.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/**
 * Reduced-motion conformance, run as a separate Playwright project with
 * `reducedMotion: 'reduce'`.
 *
 * The requirement is not "turn the animations off" — it is that **the steps
 * remain followable with no motion at all**. That is a stronger claim, and it is
 * the reason the whole library is built on discrete immutable frames rather than
 * on tweened transitions: with motion disabled, positions snap and the captions
 * and counters still carry the entire explanation.
 *
 * Auditing this once by hand would have been worth little. Asserting it on every
 * run is worth something.
 */

test('animation duration is zeroed when the OS asks for reduced motion', async ({
  page,
}) => {
  await page.goto('2-data-structures/heaps/');

  const { matches, duration } = await page.evaluate(() => ({
    // Assert the emulation itself, so a config change that stops applying it
    // fails loudly instead of quietly making the rest of this file vacuous.
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    duration: getComputedStyle(document.documentElement)
      .getPropertyValue('--viz-duration')
      .trim(),
  }));

  expect(matches, 'reduced-motion emulation should be active').toBe(true);
  // The browser normalises `0ms` to `0s`, so compare numerically.
  expect(parseFloat(duration)).toBe(0);
});

test('stepping still works and still explains itself without motion', async ({
  page,
}) => {
  await page.goto('2-data-structures/heaps/');

  const widget = page.locator('.viz-frame').first();
  await widget.scrollIntoViewIfNeeded();
  await expect(
    page.locator('astro-island[ssr]').filter({ has: page.locator('.viz-frame') }),
  ).toHaveCount(0, { timeout: 15_000 });

  // The widget opens on a one-step idle trace; an insert gives it a real one.
  await widget.getByRole('button', { name: 'insert' }).click();

  const next = page.getByRole('button', { name: 'Next step' }).first();
  await expect(next).toBeEnabled();

  const caption = page.locator('.viz-frame__caption').first();
  const captions: string[] = [];

  for (let i = 0; i < 4; i++) {
    captions.push((await caption.innerText()).trim());
    await next.click();
  }

  // Each step must say something, and consecutive steps must say something
  // different — otherwise the reader has no way to follow what changed once
  // the animation is gone.
  for (const text of captions) expect(text.length).toBeGreaterThan(10);
  expect(new Set(captions).size).toBeGreaterThan(1);
});

test('no element animates when reduced motion is requested', async ({ page }) => {
  await page.goto('3-algorithms/sorting/');

  const widget = page.locator('.viz-frame').first();
  await widget.scrollIntoViewIfNeeded();
  await expect(
    page.locator('astro-island[ssr]').filter({ has: page.locator('.viz-frame') }),
  ).toHaveCount(0, { timeout: 15_000 });

  // Nothing should have a running CSS animation or a non-zero transition.
  const moving = await page.evaluate(() => {
    return [...document.querySelectorAll('.viz-frame *')].filter((el) => {
      const s = getComputedStyle(el);
      const dur = (v: string) =>
        v.split(',').some((d) => parseFloat(d) > 0 && !d.includes('0s'));
      return dur(s.animationDuration) || dur(s.transitionDuration);
    }).length;
  });

  expect(moving).toBe(0);
});
