import type { ReactNode } from 'react';

interface VizFrameProps {
  title: string;
  /**
   * The current step's narration. Rendered in a fixed-height region so the page
   * does not reflow as captions change length — a visualisation that shoves the
   * prose around every 900ms is worse than no visualisation.
   */
  caption?: string;
  /** One-line framing shown once, above the visual. */
  intro?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The chrome every widget sits in.
 *
 * Its job is consistency: same border, same title treatment, same place for the
 * narration, same overflow behaviour on narrow screens. A reader who has learned
 * to use one widget on this site has learned to use all of them.
 *
 * `data-pagefind-ignore` keeps widget internals out of the search index, so a
 * search for "swap" returns the prose that explains swapping rather than a
 * caption fragment from a heap animation.
 */
export function VizFrame({ title, caption, intro, children, footer }: VizFrameProps) {
  return (
    <figure className="viz-frame" data-pagefind-ignore>
      <figcaption className="viz-frame__head">
        <span className="viz-frame__title">{title}</span>
        {intro && <span className="viz-frame__intro">{intro}</span>}
      </figcaption>

      <div className="viz-frame__body">{children}</div>

      {caption !== undefined && (
        <p className="viz-frame__caption" aria-live="polite">
          {caption}
        </p>
      )}

      {footer && <div className="viz-frame__footer">{footer}</div>}
    </figure>
  );
}

/** Side-by-side panes — BFS beside DFS, before beside after. Stacks on mobile. */
export function VizRow({ children }: { children: ReactNode }) {
  return <div className="viz-row">{children}</div>;
}

/** Stacked panes — the tree above its backing array. */
export function VizStack({ children }: { children: ReactNode }) {
  return <div className="viz-stack">{children}</div>;
}
