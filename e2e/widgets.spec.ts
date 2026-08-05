import { expect, test, type Page } from '@playwright/test';

/**
 * The gap this file exists to close.
 *
 * Every widget has trace tests (pure functions) and jsdom tests (hand-mounted
 * components). Neither exercises **hydration** — Astro shipping the island's
 * JavaScript, React attaching to server-rendered markup, and the thing becoming
 * interactive. A widget can pass all 212 unit tests and be a static picture in
 * production, and until this file existed nothing would have noticed.
 *
 * So each test here does the same three things: confirm the server-rendered
 * markup is present, confirm it becomes interactive, and confirm interacting
 * with it changes what the reader sees.
 */

/**
 * `client:visible` islands only hydrate once scrolled into view, so every test
 * has to scroll first.
 *
 * The readiness signal is Astro's own: `<astro-island>` carries an `ssr`
 * attribute in the server-rendered markup and removes it once React has
 * attached. Waiting on that is exact, whereas waiting on "some button is
 * enabled" is a guess about the widget's initial state — and a wrong one, since
 * several widgets legitimately start on a single-step trace with the step
 * controls disabled.
 */
async function hydrate(page: Page, selector: string) {
  const widget = page.locator(selector).first();
  await widget.scrollIntoViewIfNeeded();

  const island = page
    .locator('astro-island')
    .filter({ has: page.locator(selector) })
    .first();
  await expect(island).not.toHaveAttribute('ssr', /.*/, { timeout: 15_000 });

  return widget;
}

const caption = (page: Page) => page.locator('.viz-frame__caption').first();

/**
 * Drag the scrubber to the end.
 *
 * Assigning `el.value` directly does **not** trigger React's onChange: React
 * installs its own value setter on the input and tracks the last value it saw,
 * so a direct assignment looks like no change at all. Going through the native
 * prototype setter first is what makes React notice — the standard workaround,
 * and the same trap that made an earlier manual browser check appear to show a
 * dead widget.
 */
async function scrubToEnd(widget: ReturnType<Page['locator']>) {
  await widget.getByLabel('Scrub through steps').evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, input.max);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** First counter value in each comparison pane (each pane renders several). */
async function paneCounters(widget: ReturnType<Page['locator']>) {
  return widget
    .locator('.compare-pane')
    .evaluateAll((panes) =>
      panes.map((p) => Number(p.querySelector('.viz-counters__value')!.textContent)),
    );
}

test('HeapExplorer hydrates and animates tree and array together', async ({ page }) => {
  await page.goto('2-data-structures/heaps/');
  const widget = await hydrate(page, '.viz-frame');

  // Both views exist and share cell identity — the page's central claim.
  await expect(widget.locator('.viz-node').first()).toBeVisible();
  await expect(widget.locator('.viz-cell').first()).toBeVisible();

  // The widget opens on a one-step idle trace, so "Next step" is correctly
  // disabled until an operation produces something to step through. Running an
  // insert is what makes the controls live.
  const next = page.getByRole('button', { name: 'Next step' }).first();
  await expect(next).toBeDisabled();

  await widget.getByRole('button', { name: 'insert' }).click();
  await expect(next).toBeEnabled();

  const before = await caption(page).innerText();
  await next.click();
  await expect(caption(page)).not.toHaveText(before);
});

test('SortRace runs two algorithms and the counters diverge', async ({ page }) => {
  await page.goto('3-algorithms/sorting/');
  const widget = await hydrate(page, '.viz-frame');

  await expect(widget.locator('.compare-pane')).toHaveCount(2);

  await scrubToEnd(widget);
  const [bubble, merge] = await paneCounters(widget);

  // Defaults are bubble vs merge on random input: merge must do fewer.
  expect(bubble).toBeGreaterThan(0);
  expect(merge).toBeLessThan(bubble!);
});

test('SortRace input presets invert the ranking', async ({ page }) => {
  await page.goto('3-algorithms/sorting/');
  const widget = await hydrate(page, '.viz-frame');

  await widget.getByRole('button', { name: 'already sorted' }).click();
  await scrubToEnd(widget);

  const [bubble, merge] = await paneCounters(widget);

  // Bubble sort's early exit: 7 comparisons for 8 sorted elements, against
  // merge sort's 12. The ranking inverts, which is the whole point of the
  // preset — and exactly what no complexity table shows you.
  expect(bubble).toBe(7);
  expect(merge).toBeGreaterThan(bubble!);
});

test('EventLoopSim shows four queues and reaches the real output', async ({ page }) => {
  await page.goto('5-systems/event-loop/');
  const widget = await hydrate(page, '.viz-frame');

  // The layout fix: four columns laid out horizontally, so left-to-right reads
  // as the order the loop drains them. This is the assertion that would have
  // caught the earlier 3 + 1 wrap.
  await expect(widget.locator('.loop-column')).toHaveCount(4);

  const boxes = await widget.locator('.loop-column').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    }),
  );

  // Strictly increasing lefts and equal widths: four side-by-side tracks. Note
  // this deliberately does not compare `top` — the columns hold different
  // amounts of content, and a few pixels of vertical difference is cosmetic
  // rather than a wrap.
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.left).toBeGreaterThan(boxes[i - 1]!.left);
    expect(boxes[i]!.width).toBe(boxes[0]!.width);
  }

  await scrubToEnd(widget);
  await expect(widget.locator('.loop-output__pre')).toHaveText('1\n5\n4\n3\n2');
});

test('HashPlayground can force a collision', async ({ page }) => {
  await page.goto('2-data-structures/hash-tables/');
  const widget = await hydrate(page, '.viz-frame');

  await expect(widget.locator('.hash-table__row')).toHaveCount(8);
  await widget.getByRole('button', { name: 'force a collision' }).click();
  await expect(caption(page)).not.toHaveText('');
});

test('the quiz reveals its explanation only after answering', async ({ page }) => {
  await page.goto('1-complexity/big-o/');

  const quiz = page.locator('.quiz').first();
  await quiz.scrollIntoViewIfNeeded();

  // The radio is enabled in the server-rendered markup too, so waiting on it
  // would prove nothing. Wait for *this* island instead — a page has several
  // quizzes and the ones still below the fold are legitimately un-hydrated, so
  // waiting for zero un-hydrated islands would never succeed.
  const island = page
    .locator('astro-island')
    .filter({ has: page.locator('.quiz') })
    .first();
  await expect(island).not.toHaveAttribute('ssr', /.*/, { timeout: 15_000 });

  // Options are radios inside labels, not buttons — the quiz is a form control,
  // which is why it is keyboard- and screen-reader-navigable for free.
  const option = quiz.locator('.quiz__option input[type="radio"]').first();
  await expect(option).toBeEnabled();

  // The explanation is the payload; hiding it until an answer is committed is
  // what makes it self-testing rather than reading.
  const explanation = quiz.locator('.quiz__explanation');
  await expect(explanation).toHaveCount(0);

  await option.check();
  await expect(explanation).toBeVisible();

  // And answering locks the options, so you cannot retro-fit a "correct" answer.
  await expect(option).toBeDisabled();
});

/**
 * One working quiz does not prove the other 56 work — the failure mode here was
 * per-call-site (how the explanation was passed), so it is worth sampling one
 * page per section rather than trusting a single instance.
 */
for (const url of [
  '2-data-structures/hash-tables/',
  '3-algorithms/recursion/',
  '4-paradigms/dynamic-programming/',
  '5-systems/testing/',
  '6-languages/solid/',
  '10-ai-engineering/embeddings/',
  '10-ai-engineering/agents/',
]) {
  test(`quiz on ${url} answers correctly`, async ({ page }) => {
    await page.goto(url);

    const quiz = page.locator('.quiz').first();
    await quiz.scrollIntoViewIfNeeded();

    const island = page
      .locator('astro-island')
      .filter({ has: page.locator('.quiz') })
      .first();
    await expect(island).not.toHaveAttribute('ssr', /.*/, { timeout: 15_000 });

    await quiz.locator('.quiz__option input[type="radio"]').first().check();
    await expect(quiz.locator('.quiz__explanation')).toBeVisible();
  });
}

test('keyboard-only operation of the step controls', async ({ page }) => {
  await page.goto('2-data-structures/heaps/');
  const widget = await hydrate(page, '.viz-frame');

  // Give the player something to step through first.
  await widget.getByRole('button', { name: 'insert' }).click();

  const next = page.getByRole('button', { name: 'Next step' }).first();
  await expect(next).toBeEnabled();

  const before = await caption(page).innerText();

  // Focus and activate with the keyboard alone — no pointer events at all.
  await next.focus();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(caption(page)).not.toHaveText(before);

  // The arrow-key shortcut, which is the reason a step-through widget is
  // usable at all — it only fires while focus is inside the widget.
  const afterEnter = await caption(page).innerText();
  await page.keyboard.press('ArrowRight');
  await expect(caption(page)).not.toHaveText(afterEnter);

  await page.keyboard.press('ArrowLeft');
  await expect(caption(page)).toHaveText(afterEnter);
});

/**
 * VectorSpace — the embeddings widget.
 *
 * The claim it exists to make is that cosine and Euclidean genuinely disagree
 * on the default pair, and the whole surrounding page argues from that. So the
 * test asserts the numbers rather than merely that something rendered: if a
 * corpus edit ever makes the two metrics agree, the widget stops teaching what
 * the prose says it teaches, and this goes red.
 */
test('VectorSpace computes real similarities and updates on selection', async ({
  page,
}) => {
  await page.goto('10-ai-engineering/embeddings/');
  const widget = await hydrate(page, '.viz-frame');

  // Ten sentences, ten points.
  await expect(widget.locator('.vector-space__pt')).toHaveCount(10);

  const counters = widget.locator('.viz-counters__value');
  const cosineBefore = await counters.first().innerText();
  expect(Number(cosineBefore)).toBeGreaterThan(0);
  expect(Number(cosineBefore)).toBeLessThanOrEqual(1);

  // The default pair is the one the prose walks through: the two database
  // sentences of very different lengths, where the metrics disagree.
  await expect(widget.locator('.vector-space__note')).toBeVisible();

  // Selecting a different sentence must change the readout.
  await widget
    .locator('.vector-space__slot--b select')
    .selectOption({ label: 'heat the pan and add the onion' });

  await expect(counters.first()).not.toHaveText(cosineBefore);

  // Cooking versus databases share no vocabulary at all — exactly 0, and the
  // caption switches to the right-angle wording.
  await expect(counters.first()).toHaveText('0.000');
  await expect(caption(page)).toContainText('share no words at all');
});

test('mermaid diagrams render to inline SVG with no runtime library', async ({
  page,
}) => {
  await page.goto('10-ai-engineering/embeddings/');

  const diagram = page.locator("svg[id^='mermaid-']").first();
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toBeVisible();

  // Real rendered text, not an unprocessed ```mermaid fence.
  await expect(diagram).toContainText('Vector index');
  await expect(page.locator('main')).not.toContainText('flowchart LR');

  // The point of build-time rendering: no mermaid bundle is ever fetched.
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.reload();
  expect(requests.filter((u) => /mermaid/i.test(u))).toEqual([]);
});

/**
 * TemperatureSampler — the sampling page's widget.
 *
 * Asserts the claim the page is built on rather than merely that it renders:
 * temperature 0 collapses to a single surviving token and produces a visibly
 * repeating output. If a corpus edit ever broke that, the page would still say
 * it happens and the widget would not show it.
 */
test('TemperatureSampler collapses to greedy at temperature 0', async ({ page }) => {
  await page.goto('10-ai-engineering/tokens-and-sampling/');
  const widget = await hydrate(page, '.viz-frame');

  const rows = widget.locator('.sampler__row');
  expect(await rows.count()).toBeGreaterThan(3);

  // At the default temperature of 1, several tokens are live.
  const liveBefore = await widget
    .locator('.sampler__row:not(.sampler__row--out)')
    .count();
  expect(liveBefore).toBeGreaterThan(1);

  // Drag temperature to 0. React installs its own value setter, so assigning
  // `.value` directly does not fire onChange — go through the prototype setter.
  await widget
    .locator('input[type="range"]')
    .nth(0)
    .evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(el, '0');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

  await expect(caption(page)).toContainText('greedy');
  await expect(widget.locator('.sampler__note')).toBeVisible();

  // Exactly one token holds all the probability mass.
  //
  // Asserted on the displayed percentages rather than the `--out` class, and the
  // difference is the point: `--out` marks tokens CUT by top-k or top-p, while
  // temperature 0 *reweights* every other token to zero without cutting
  // anything. Both leave one token in play; only one of them is a filter. An
  // earlier version of this test conflated the two and failed against correct
  // behaviour.
  const percentages = await widget.locator('.sampler__pct').allInnerTexts();
  expect(percentages.filter((text) => text === '100.0%')).toHaveLength(1);
  expect(percentages.filter((text) => text === '0.0%')).toHaveLength(
    percentages.length - 1,
  );

  // And entropy really is zero — no choice left to make.
  await expect(widget.locator('.viz-counters__value').first()).toHaveText('0.00');
});

/**
 * ChunkingLab — the page's central claim is that retrieval breaks and recovers
 * non-monotonically with chunk size. The default size of 24 splits the answer
 * on the shipped document; this pins that the failure is actually reachable.
 */
test('ChunkingLab shows the split-answer failure and recovers it', async ({ page }) => {
  await page.goto('10-ai-engineering/chunking-and-retrieval/');
  const widget = await hydrate(page, '.viz-frame');

  // Default: chunk size 24, no overlap — the answer is split.
  await expect(widget.locator('.chunk__verdict--bad')).toBeVisible();
  await expect(caption(page)).toContainText('split across a chunk boundary');

  // Raising overlap rescues it, without changing the chunk size.
  await widget
    .locator('input[type="range"]')
    .nth(1)
    .evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(el, '12');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

  await expect(widget.locator('.chunk__verdict--ok')).toBeVisible();
});

/**
 * AgentLoopStepper — asserts that loop detection actually stops the run, and
 * that disabling it lets the run continue. That toggle is the page's argument.
 */
test('AgentLoopStepper detects a repeated call and stops', async ({ page }) => {
  await page.goto('10-ai-engineering/agents/');
  const widget = await hydrate(page, '.viz-frame');

  await widget.locator('select').first().selectOption({ value: 'loop' });
  await expect(widget.locator('.viz-counters__value').last()).toHaveText(
    'stopped: loop detected',
  );

  // The repeated call is marked for the reader.
  const next = page.getByRole('button', { name: 'Next step' }).first();
  await next.click();
  await next.click();
  await expect(widget.locator('.agent__turn--repeat').first()).toBeVisible();

  // Untick detection and the run no longer stops for that reason.
  await widget.locator('input[type="checkbox"]').uncheck();
  await expect(widget.locator('.viz-counters__value').last()).not.toHaveText(
    'stopped: loop detected',
  );
});

test('QueryPlanExplorer flips between index used and index declined', async ({
  page,
}) => {
  await page.goto('8-databases-storage/postgres/');
  const widget = await hydrate(page, '.viz-frame');

  // Default state: no index, so every value is a Seq Scan.
  await expect(widget.locator('.plan__verdict strong')).toHaveText(/Seq Scan/);

  // Toggle the index on while status stays 'complete' (92% selectivity) --
  // the planner should still decline it.
  await widget.getByRole('button', { name: 'CREATE INDEX' }).click();
  await expect(widget.locator('.plan__verdict')).not.toHaveClass(/--index/);

  // Switch to the rare value: same index, opposite decision.
  await widget.getByRole('button', { name: 'cancelled' }).click();
  await expect(widget.locator('.plan__verdict')).toHaveClass(/--index/);
  await expect(widget.locator('.plan__verdict strong')).toHaveText(/Index/);
});

test('JoinVisualiser shows fan-out inflating the row count', async ({ page }) => {
  await page.goto('8-databases-storage/indexes-and-query-plans/');
  const widget = await hydrate(page, '.viz-frame');

  // INNER JOIN is the default: 3 rows from 4 employees, NULL and the
  // missing department both dropped.
  await expect(widget.locator('.join__table--result caption')).toContainText('3');

  await widget.getByRole('button', { name: 'LEFT JOIN' }).click();

  // Four employees, five rows -- the headline fan-out fact.
  await expect(widget.locator('.join__table--result caption')).toContainText('5');
  await expect(widget.locator('.join__warning')).toContainText('Ana');
});

test('PartitionKeyExplorer trades distribution against query routing', async ({
  page,
}) => {
  await page.goto('8-databases-storage/cosmosdb/');
  const widget = await hydrate(page, '.viz-frame');

  // /tenantId is the default: skewed, but routes most sample queries.
  const skewBefore = await widget
    .locator('.viz-counters__item')
    .filter({ hasText: 'skew' })
    .locator('.viz-counters__value')
    .innerText();

  await widget.getByRole('button', { name: '/id' }).click();

  // /id spreads far more evenly...
  const skewAfter = await widget
    .locator('.viz-counters__item')
    .filter({ hasText: 'skew' })
    .locator('.viz-counters__value')
    .innerText();
  // Rendered as e.g. "5.64×" -- parseFloat stops at the suffix, Number() would not.
  expect(parseFloat(skewAfter)).toBeLessThan(parseFloat(skewBefore));

  // ...and routes fewer of the sample queries -- the axis it loses on.
  const routableAfter = await widget
    .locator('.viz-counters__item')
    .filter({ hasText: 'queries routable' })
    .locator('.viz-counters__value')
    .innerText();
  expect(Number(routableAfter)).toBe(1);
});
