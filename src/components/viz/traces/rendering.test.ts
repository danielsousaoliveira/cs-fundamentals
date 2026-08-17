import { describe, expect, it } from 'vitest';
import { buildTimeline, STRATEGIES, tracksOf, type Strategy } from './rendering.ts';

const ALL: Strategy[] = STRATEGIES.map((s) => s.id);

describe('event ordering', () => {
  it('never starts an event before the previous one on the same track ends', () => {
    for (const strategy of ALL) {
      const timeline = buildTimeline(strategy);
      const byTrack = new Map<string, typeof timeline.events>();
      for (const event of timeline.events) {
        byTrack.set(event.track, [...(byTrack.get(event.track) ?? []), event]);
      }
      for (const events of byTrack.values()) {
        for (let i = 1; i < events.length; i++) {
          expect(events[i]!.start).toBe(events[i - 1]!.end);
        }
      }
    }
  });

  it('never has an event end before it starts', () => {
    for (const strategy of ALL) {
      for (const event of buildTimeline(strategy).events) {
        expect(event.end).toBeGreaterThanOrEqual(event.start);
      }
    }
  });

  it('starts every timeline at t=0', () => {
    for (const strategy of ALL) {
      const timeline = buildTimeline(strategy);
      expect(Math.min(...timeline.events.map((e) => e.start))).toBe(0);
    }
  });
});

describe('marked timings', () => {
  it('orders ttfb before first paint before hydration for every strategy', () => {
    for (const strategy of ALL) {
      const timeline = buildTimeline(strategy);
      expect(timeline.ttfb).toBeGreaterThan(0);
      expect(timeline.firstPaint).toBeGreaterThanOrEqual(timeline.ttfb);
      expect(timeline.hydration).toBeGreaterThanOrEqual(timeline.firstPaint);
      expect(timeline.total).toBeGreaterThanOrEqual(timeline.hydration);
    }
  });

  it('marks LCP no earlier than first paint everywhere', () => {
    for (const strategy of ALL) {
      const timeline = buildTimeline(strategy);
      expect(timeline.lcp).toBeGreaterThanOrEqual(timeline.firstPaint);
    }
  });

  it('is deterministic', () => {
    for (const strategy of ALL) {
      expect(buildTimeline(strategy)).toEqual(buildTimeline(strategy));
    }
  });
});

describe('the strategies actually differ', () => {
  it('gives static the fastest ttfb, from the edge cache rather than a render', () => {
    const static_ = buildTimeline('static');
    const ssr = buildTimeline('ssr');
    const csr = buildTimeline('csr');

    expect(static_.ttfb).toBeLessThan(ssr.ttfb);
    expect(static_.lcp).toBeLessThan(csr.lcp);
  });

  it('lets streaming answer with a fast shell while SSR blocks on the full render', () => {
    const streaming = buildTimeline('streaming');
    const ssr = buildTimeline('ssr');

    expect(streaming.ttfb).toBeLessThan(ssr.ttfb);
    // Streaming overlaps the slow data fetch with the shell's own transfer, so
    // real content still lands no later than SSR's single blocking render.
    expect(streaming.lcp).toBeLessThanOrEqual(ssr.lcp);
  });

  it('delays CSR LCP far past every other strategy, because content only appears after hydration fetches it', () => {
    const csr = buildTimeline('csr');
    for (const strategy of ['static', 'ssr', 'streaming', 'isr'] as Strategy[]) {
      expect(csr.lcp).toBeGreaterThan(buildTimeline(strategy).lcp);
    }
    // The defining CSR property: LCP happens strictly after hydration, not
    // alongside or before it, because there is nothing to paint until the
    // hydrated app fetches its own data.
    expect(csr.lcp).toBeGreaterThan(csr.hydration);
  });

  it('gives ISR the same reader-facing timeline as static, since a live request is a cache hit', () => {
    const isr = buildTimeline('isr');
    const static_ = buildTimeline('static');

    expect(isr.ttfb).toBe(static_.ttfb);
    expect(isr.firstPaint).toBe(static_.firstPaint);
    expect(isr.lcp).toBe(static_.lcp);
  });

  it('runs ISR revalidation in the background, off the critical path', () => {
    const isr = buildTimeline('isr');
    const revalidate = isr.events.find((e) => e.id === 'revalidate');

    expect(revalidate).toBeDefined();
    expect(revalidate!.blocking).toBe(false);
    // The regeneration starts alongside the response, not after it — it runs
    // independently and is not on the path to first paint or hydration.
    expect(revalidate!.start).toBe(isr.ttfb);
    expect(revalidate!.end).toBeGreaterThan(isr.firstPaint);
  });
});

describe('tracksOf', () => {
  it('lists only tracks a strategy actually uses, in a stable order', () => {
    expect(tracksOf(buildTimeline('static'))).toEqual(['main', 'js']);
    expect(tracksOf(buildTimeline('streaming'))).toEqual(['main', 'content', 'js']);
    expect(tracksOf(buildTimeline('csr'))).toEqual(['main', 'js', 'fetch']);
    expect(tracksOf(buildTimeline('isr'))).toEqual(['main', 'js', 'revalidate']);
  });
});
