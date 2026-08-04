import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the **built** site.
 *
 * These exist to cover the one thing the jsdom tests structurally cannot: that
 * the islands actually hydrate and the widgets actually work in a real browser.
 * Everything up to this point verified the trace generators (pure functions) and
 * the components (jsdom, hand-mounted) — neither of which exercises Astro's
 * hydration, the `client:visible` directive, the base path, or the CSS.
 *
 * Deliberately run against `astro preview` rather than `astro dev`: the dev
 * server serves unbundled modules and does not apply the `/cs-fundamentals`
 * base path the same way, so a passing dev run would prove less than it appears
 * to. The built output is what gets deployed, so the built output is what is
 * tested.
 */
export default defineConfig({
  testDir: './e2e',
  // The suite is small and fast; a flake here should be investigated rather
  // than retried away. See the testing page's argument about flaky suites.
  retries: 0,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    /**
     * Trailing slash is load-bearing. Playwright resolves with `new URL(path,
     * baseURL)` semantics, so a leading-slash path like `/foo` discards the
     * base path entirely and requests the origin root — which 404s under a
     * project-page deployment. With the trailing slash and *relative* gotos
     * (`'2-data-structures/heaps/'`), the base is preserved.
     */
    baseURL: 'http://localhost:4322/cs-fundamentals/',
    trace: 'on-first-retry',
  },

  /**
   * One project. An earlier version had a second `reduced-motion` project
   * setting `use: { reducedMotion: 'reduce' }`, which silently did not apply —
   * `matchMedia('(prefers-reduced-motion: reduce)')` still reported false, so
   * the tests were asserting against normal-motion rendering and only passed
   * by accident. `motion.spec.ts` now calls `page.emulateMedia()` directly,
   * which is explicit, verifiable, and cannot fail open.
   */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'pnpm build && pnpm preview --port 4322',
    url: 'http://localhost:4322/cs-fundamentals/',
    /**
     * Port 4322, not the dev server's 4321. Sharing the port lets
     * `reuseExistingServer` silently attach to a running `astro dev` — which
     * serves unbundled modules and a different base-path setup, so the suite
     * would pass against something that is not what gets deployed.
     */
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
