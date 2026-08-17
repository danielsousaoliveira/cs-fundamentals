export type Strategy = 'static' | 'ssr' | 'streaming' | 'csr' | 'isr';

export type EventKind =
  'network' | 'render' | 'transfer' | 'parse' | 'fetch' | 'revalidate';

export type Track = 'main' | 'js' | 'content' | 'fetch' | 'revalidate';

export interface TimelineEvent {
  id: string;
  label: string;
  kind: EventKind;
  track: Track;
  start: number;
  end: number;
  blocking: boolean;
}

export interface StrategyTimeline {
  strategy: Strategy;
  label: string;
  events: TimelineEvent[];
  ttfb: number;
  firstPaint: number;
  hydration: number;
  lcp: number;
  total: number;
}

export const STRATEGIES: { id: Strategy; label: string }[] = [
  { id: 'static', label: 'Static (SSG)' },
  { id: 'ssr', label: 'Server-rendered (SSR)' },
  { id: 'streaming', label: 'Streaming SSR' },
  { id: 'csr', label: 'Client-rendered (CSR)' },
  { id: 'isr', label: 'Incremental regeneration (ISR)' },
];

const NETWORK_LATENCY = 60;
const CDN_CACHE_LOOKUP = 4;
const DB_FETCH = 70;
const SERVER_RENDER = 90;
const SHELL_RENDER = 20;
const HTML_TRANSFER = 35;
const HTML_PARSE = 25;
const JS_TRANSFER = 110;
const JS_PARSE = 90;
const HYDRATE = 140;
const CLIENT_FETCH = 90;
const CLIENT_RENDER = 40;

interface RawEvent {
  id: string;
  label: string;
  kind: EventKind;
  track: Track;
  duration: number;
  blocking?: boolean;
}

function chain(
  events: RawEvent[],
  startAt: number,
): { events: TimelineEvent[]; end: number } {
  let cursor = startAt;
  const out: TimelineEvent[] = [];
  for (const raw of events) {
    const start = cursor;
    const end = cursor + raw.duration;
    out.push({
      id: raw.id,
      label: raw.label,
      kind: raw.kind,
      track: raw.track,
      start,
      end,
      blocking: raw.blocking ?? true,
    });
    cursor = end;
  }
  return { events: out, end: cursor };
}

function buildStatic(): StrategyTimeline {
  const main = chain(
    [
      {
        id: 'request',
        label: 'Request sent to the CDN edge',
        kind: 'network',
        track: 'main',
        duration: NETWORK_LATENCY,
      },
      {
        id: 'cache-hit',
        label: 'Edge cache hit — no origin round trip',
        kind: 'render',
        track: 'main',
        duration: CDN_CACHE_LOOKUP,
      },
      {
        id: 'html-transfer',
        label: 'Prerendered HTML downloads',
        kind: 'transfer',
        track: 'main',
        duration: HTML_TRANSFER,
      },
      {
        id: 'html-parse',
        label: 'Browser parses and paints the markup',
        kind: 'parse',
        track: 'main',
        duration: HTML_PARSE,
      },
    ],
    0,
  );

  const ttfb = main.events[1]!.end;
  const firstPaint = main.events[3]!.end;

  const js = chain(
    [
      {
        id: 'js-transfer',
        label: 'Island JS downloads',
        kind: 'transfer',
        track: 'js',
        duration: JS_TRANSFER,
        blocking: false,
      },
      {
        id: 'js-parse',
        label: 'Browser parses the island bundle',
        kind: 'parse',
        track: 'js',
        duration: JS_PARSE,
        blocking: false,
      },
    ],
    ttfb,
  );

  const hydrateStart = Math.max(firstPaint, js.end);
  const hydrate = chain(
    [
      {
        id: 'hydrate',
        label: 'Widgets attach event handlers',
        kind: 'render',
        track: 'js',
        duration: HYDRATE,
        blocking: false,
      },
    ],
    hydrateStart,
  );

  return {
    strategy: 'static',
    label: 'Static (SSG)',
    events: [...main.events, ...js.events, ...hydrate.events],
    ttfb,
    firstPaint,
    hydration: hydrate.end,
    lcp: firstPaint,
    total: hydrate.end,
  };
}

function buildSsr(): StrategyTimeline {
  const main = chain(
    [
      {
        id: 'request',
        label: 'Request sent to the origin server',
        kind: 'network',
        track: 'main',
        duration: NETWORK_LATENCY,
      },
      {
        id: 'render',
        label: 'Server fetches data and renders the page',
        kind: 'render',
        track: 'main',
        duration: DB_FETCH + SERVER_RENDER,
      },
      {
        id: 'html-transfer',
        label: 'Rendered HTML downloads',
        kind: 'transfer',
        track: 'main',
        duration: HTML_TRANSFER,
      },
      {
        id: 'html-parse',
        label: 'Browser parses and paints the markup',
        kind: 'parse',
        track: 'main',
        duration: HTML_PARSE,
      },
    ],
    0,
  );

  const ttfb = main.events[1]!.end;
  const firstPaint = main.events[3]!.end;

  const js = chain(
    [
      {
        id: 'js-transfer',
        label: 'Client JS downloads',
        kind: 'transfer',
        track: 'js',
        duration: JS_TRANSFER,
        blocking: false,
      },
      {
        id: 'js-parse',
        label: 'Browser parses the bundle',
        kind: 'parse',
        track: 'js',
        duration: JS_PARSE,
        blocking: false,
      },
    ],
    ttfb,
  );

  const hydrateStart = Math.max(firstPaint, js.end);
  const hydrate = chain(
    [
      {
        id: 'hydrate',
        label: 'Page attaches event handlers',
        kind: 'render',
        track: 'js',
        duration: HYDRATE,
        blocking: false,
      },
    ],
    hydrateStart,
  );

  return {
    strategy: 'ssr',
    label: 'Server-rendered (SSR)',
    events: [...main.events, ...js.events, ...hydrate.events],
    ttfb,
    firstPaint,
    hydration: hydrate.end,
    lcp: firstPaint,
    total: hydrate.end,
  };
}

function buildStreaming(): StrategyTimeline {
  const main = chain(
    [
      {
        id: 'request',
        label: 'Request sent to the origin server',
        kind: 'network',
        track: 'main',
        duration: NETWORK_LATENCY,
      },
      {
        id: 'shell-render',
        label: 'Server renders the shell instantly — slow data left in Suspense',
        kind: 'render',
        track: 'main',
        duration: SHELL_RENDER,
      },
      {
        id: 'shell-transfer',
        label: 'Shell HTML downloads',
        kind: 'transfer',
        track: 'main',
        duration: HTML_TRANSFER,
      },
      {
        id: 'shell-parse',
        label: 'Browser paints the shell and its loading skeleton',
        kind: 'parse',
        track: 'main',
        duration: HTML_PARSE,
      },
    ],
    0,
  );

  const ttfb = main.events[1]!.end;
  const firstPaint = main.events[3]!.end;

  const content = chain(
    [
      {
        id: 'content-render',
        label: 'Slow data resolves on the server, in parallel with the shell',
        kind: 'render',
        track: 'content',
        duration: DB_FETCH + SERVER_RENDER,
      },
      {
        id: 'content-transfer',
        label: 'Streamed HTML chunk arrives',
        kind: 'transfer',
        track: 'content',
        duration: HTML_TRANSFER / 2,
      },
      {
        id: 'content-paint',
        label: 'Chunk replaces the loading skeleton',
        kind: 'parse',
        track: 'content',
        duration: HTML_PARSE / 2,
      },
    ],
    ttfb,
  );

  const lcp = content.end;

  const js = chain(
    [
      {
        id: 'js-transfer',
        label: 'Client JS downloads',
        kind: 'transfer',
        track: 'js',
        duration: JS_TRANSFER,
        blocking: false,
      },
      {
        id: 'js-parse',
        label: 'Browser parses the bundle',
        kind: 'parse',
        track: 'js',
        duration: JS_PARSE,
        blocking: false,
      },
    ],
    ttfb,
  );

  const hydrateStart = Math.max(firstPaint, js.end);
  const hydrate = chain(
    [
      {
        id: 'hydrate',
        label: 'Shell hydrates independently of the slow chunk',
        kind: 'render',
        track: 'js',
        duration: HYDRATE,
        blocking: false,
      },
    ],
    hydrateStart,
  );

  return {
    strategy: 'streaming',
    label: 'Streaming SSR',
    events: [...main.events, ...content.events, ...js.events, ...hydrate.events],
    ttfb,
    firstPaint,
    hydration: hydrate.end,
    lcp,
    total: Math.max(hydrate.end, content.end),
  };
}

function buildCsr(): StrategyTimeline {
  const main = chain(
    [
      {
        id: 'request',
        label: 'Request sent to the server',
        kind: 'network',
        track: 'main',
        duration: NETWORK_LATENCY,
      },
      {
        id: 'render',
        label: 'Server returns a near-empty HTML shell — no data, no markup',
        kind: 'render',
        track: 'main',
        duration: CDN_CACHE_LOOKUP,
      },
      {
        id: 'html-transfer',
        label: 'Empty shell downloads',
        kind: 'transfer',
        track: 'main',
        duration: HTML_TRANSFER / 2,
      },
      {
        id: 'html-parse',
        label: 'Browser paints an empty shell — nothing to see yet',
        kind: 'parse',
        track: 'main',
        duration: HTML_PARSE / 2,
      },
    ],
    0,
  );

  const ttfb = main.events[1]!.end;
  const firstPaint = main.events[3]!.end;

  const js = chain(
    [
      {
        id: 'js-transfer',
        label: 'The whole application bundle downloads',
        kind: 'transfer',
        track: 'js',
        duration: JS_TRANSFER + 40,
      },
      {
        id: 'js-parse',
        label: 'Browser parses the application bundle',
        kind: 'parse',
        track: 'js',
        duration: JS_PARSE,
      },
    ],
    ttfb,
  );

  const hydrate = chain(
    [
      {
        id: 'hydrate',
        label: 'App attaches event handlers to the empty shell',
        kind: 'render',
        track: 'js',
        duration: HYDRATE,
        blocking: false,
      },
    ],
    Math.max(firstPaint, js.end),
  );

  const fetchChain = chain(
    [
      {
        id: 'client-fetch',
        label: 'Hydrated app fetches data from the API',
        kind: 'fetch',
        track: 'fetch',
        duration: CLIENT_FETCH,
      },
      {
        id: 'client-render',
        label: 'React renders the fetched data',
        kind: 'render',
        track: 'fetch',
        duration: CLIENT_RENDER,
      },
    ],
    hydrate.end,
  );

  return {
    strategy: 'csr',
    label: 'Client-rendered (CSR)',
    events: [...main.events, ...js.events, ...hydrate.events, ...fetchChain.events],
    ttfb,
    firstPaint,
    hydration: hydrate.end,
    lcp: fetchChain.end,
    total: fetchChain.end,
  };
}

function buildIsr(): StrategyTimeline {
  const base = buildStatic();

  const revalidate = chain(
    [
      {
        id: 'revalidate',
        label:
          'Stale page served instantly; a fresh copy regenerates in the background for the next visitor',
        kind: 'revalidate',
        track: 'revalidate',
        duration: DB_FETCH + SERVER_RENDER,
        blocking: false,
      },
    ],
    base.ttfb,
  );

  return {
    ...base,
    strategy: 'isr',
    label: 'Incremental regeneration (ISR)',
    events: [...base.events, ...revalidate.events],
    total: Math.max(base.total, revalidate.end),
  };
}

const BUILDERS: Record<Strategy, () => StrategyTimeline> = {
  static: buildStatic,
  ssr: buildSsr,
  streaming: buildStreaming,
  csr: buildCsr,
  isr: buildIsr,
};

export function buildTimeline(strategy: Strategy): StrategyTimeline {
  return BUILDERS[strategy]();
}

export function tracksOf(timeline: StrategyTimeline): Track[] {
  const order: Track[] = ['main', 'content', 'js', 'fetch', 'revalidate'];
  const present = new Set(timeline.events.map((e) => e.track));
  return order.filter((t) => present.has(t));
}
