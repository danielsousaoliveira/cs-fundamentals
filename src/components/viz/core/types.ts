/**
 * The step model every visualisation on this site is built on.
 *
 * The organising idea: a widget is a **pure trace generator plus a renderer**.
 * The algorithm runs once, ahead of time, producing an array of immutable
 * snapshots. Nothing animates by mutating state; the player just moves an index
 * and the renderer diffs.
 *
 * Three things fall out of that for free:
 *   - **Scrubbing and stepping backwards**, because every frame already exists.
 *   - **Testability**, because a trace is a value you can assert on without a DOM.
 *     This matters more than it sounds: it is how we stop a visualisation from
 *     quietly lying about the algorithm it claims to show.
 *   - **Reduced-motion support**, because the steps carry the meaning and the
 *     animation is only the transition between them.
 */

/**
 * How a cell or node is participating in the current step.
 *
 * Roles form a deliberate lightness ladder (see tokens.css):
 * `default < compare < active < swap < sorted`. Colour is never the only signal —
 * each role also carries a distinct border weight — so the visuals survive
 * colour-blindness and greyscale.
 */
export type VizRole =
  'default' | 'active' | 'compare' | 'swap' | 'sorted' | 'ghost' | 'empty';

export type VizValue = number | string;

export interface CellState {
  /**
   * Stable across the whole trace. This is the load-bearing detail of the entire
   * library: a swap changes two cells' `index`, never their `id`, so the
   * renderer's FLIP animation slides them past each other with no tweening code.
   *
   * Sharing an `id` between a tree node and an array cell is also what makes the
   * heap widget's two views highlight and animate as one thing.
   */
  id: string;
  value: VizValue;
  /** Position in the array. The renderer sorts by this, not by array order. */
  index: number;
  role?: VizRole;
  /** Small text under the cell, e.g. a bucket's chain length. */
  annotation?: string;
}

export interface NodeState {
  id: string;
  value: VizValue;
  role?: VizRole;
  /** Explicit position for `layout="grid"`; ignored by the tidy tree layout. */
  x?: number;
  y?: number;
  annotation?: string;
}

export interface EdgeState {
  from: string;
  to: string;
  role?: VizRole;
  label?: string;
  directed?: boolean;
}

export interface PointerState {
  /** Short name shown on the arrow: `i`, `j`, `head`, `slow`, `parent`. */
  label: string;
  /** `id` of the cell or node being pointed at. */
  target: string;
  anchor?: 'above' | 'below';
  role?: VizRole;
}

/** One immutable frame of the animation. */
export interface VizStep {
  /**
   * Prose for THIS step, shown under the visual. Write these as sentences a
   * reader could follow with the picture covered up — they are the narration,
   * not a label.
   */
  caption: string;

  /** 1-indexed line, or inclusive `[start, end]` range, to highlight in CodePane. */
  codeLine?: number | [number, number];

  /**
   * Running totals — `{ comparisons: 14, swaps: 3 }`. These are what turn a
   * complexity class from a claim into a number the reader watches tick.
   */
  counters?: Record<string, number>;

  cells?: CellState[];
  nodes?: NodeState[];
  edges?: EdgeState[];
  pointers?: PointerState[];

  /** Marks a phase boundary; the scrubber draws a tick here. */
  phase?: string;
}

/** A complete, replayable run of one algorithm. */
export interface VizTrace {
  steps: VizStep[];
  /** Source shown in CodePane, keyed by language. */
  code?: Partial<Record<'python' | 'typescript', string>>;
  /** Display config for counters, e.g. an analytic bound to compare against. */
  counterSpec?: CounterSpec[];
}

export interface CounterSpec {
  key: string;
  label: string;
  /**
   * Optional analytic comparison, e.g. `n => n * Math.log2(n)`, rendered beside
   * the live count as `comparisons: 47 · n log₂n ≈ 53`. Seeing the measured
   * number sit next to the predicted one is the whole pedagogical point.
   */
  expected?: { label: string; value: number };
}
