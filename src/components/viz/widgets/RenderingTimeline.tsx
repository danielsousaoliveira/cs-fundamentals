import { useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  buildTimeline,
  STRATEGIES,
  tracksOf,
  type Strategy,
} from '../traces/rendering.ts';

const TRACK_LABEL: Record<string, string> = {
  main: 'response',
  content: 'streamed content',
  js: 'client JS',
  fetch: 'client fetch',
  revalidate: 'background regen',
};

function ms(n: number): string {
  return `${Math.round(n)}ms`;
}

export function RenderingTimeline() {
  const [strategy, setStrategy] = useState<Strategy>('static');

  const timeline = buildTimeline(strategy);
  const scale = Math.max(...STRATEGIES.map((s) => buildTimeline(s.id).total));
  const tracks = tracksOf(timeline);

  const marks = [
    { id: 'ttfb', label: 'TTFB', at: timeline.ttfb },
    { id: 'paint', label: 'First paint', at: timeline.firstPaint },
    { id: 'lcp', label: 'LCP', at: timeline.lcp },
    { id: 'hydrated', label: 'Hydrated', at: timeline.hydration },
  ];

  return (
    <VizFrame
      title="Rendering strategy timeline"
      intro="The same page, five ways to produce it. Watch when the byte, the pixel and the click all actually happen."
      caption={`${timeline.label}: byte at ${ms(timeline.ttfb)}, painted at ${ms(timeline.firstPaint)}, largest content at ${ms(timeline.lcp)}, interactive at ${ms(timeline.hydration)}.`}
    >
      <fieldset className="plan__field">
        <legend>rendering strategy</legend>
        <div className="plan__segmented" role="group">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`plan__seg${strategy === s.id ? ' plan__seg--on' : ''}`}
              aria-pressed={strategy === s.id}
              onClick={() => setStrategy(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="rtl__chart">
        <div className="rtl__marks">
          {marks.map((mark) => (
            <span
              key={mark.id}
              className={`rtl__mark rtl__mark--${mark.id}`}
              style={{ left: `${(mark.at / scale) * 100}%` }}
            >
              <span className="rtl__mark-line" />
              <span className="rtl__mark-label">
                {mark.label} · {ms(mark.at)}
              </span>
            </span>
          ))}
        </div>

        <ol className="rtl__tracks" aria-label={`${timeline.label} timeline`}>
          {tracks.map((track) => (
            <li key={track} className="rtl__track">
              <span className="rtl__track-label">{TRACK_LABEL[track]}</span>
              <span className="rtl__track-lane">
                {timeline.events
                  .filter((e) => e.track === track)
                  .map((event) => (
                    <span
                      key={event.id}
                      className={`rtl__event rtl__event--${event.kind}${event.blocking ? '' : ' rtl__event--async'}`}
                      style={{
                        left: `${(event.start / scale) * 100}%`,
                        width: `${Math.max(((event.end - event.start) / scale) * 100, 0.4)}%`,
                      }}
                      title={`${event.label} (${ms(event.start)}–${ms(event.end)})`}
                    >
                      <span className="rtl__event-label">{event.label}</span>
                    </span>
                  ))}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>time to first byte</dt>
          <dd>
            <span className="viz-counters__value">{ms(timeline.ttfb)}</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>largest contentful paint</dt>
          <dd>
            <span
              className={`viz-counters__value${timeline.lcp > timeline.hydration ? ' join__wrong' : ''}`}
            >
              {ms(timeline.lcp)}
            </span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>hydrated (interactive)</dt>
          <dd>
            <span className="viz-counters__value">{ms(timeline.hydration)}</span>
          </dd>
        </div>
      </dl>
    </VizFrame>
  );
}
