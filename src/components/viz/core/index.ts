/** The shared viz primitive layer. Widgets compose these; pages use widgets. */

export { VizFrame, VizRow, VizStack } from './VizFrame.tsx';
export { Cell } from './Cell.tsx';
export { ArrayStrip } from './ArrayStrip.tsx';
export { GraphCanvas } from './GraphCanvas.tsx';
export { Pointer, pointersByTarget } from './Pointer.tsx';
export { StepControls } from './StepControls.tsx';
export { Scrubber } from './Scrubber.tsx';
export { CounterBar } from './CounterBar.tsx';
export { CodePane } from './CodePane.tsx';
export { Legend } from './Legend.tsx';
export { useStepPlayer } from './useStepPlayer.ts';
export type { StepPlayer, StepPlayerOptions } from './useStepPlayer.ts';
export { layoutNodes, boundsOf } from './layout.ts';
export type { LayoutKind } from './layout.ts';
export { tokenize, isHighlighted } from './highlight.ts';
export type { Lang } from './highlight.ts';
export type {
  VizStep,
  VizTrace,
  VizRole,
  VizValue,
  CellState,
  NodeState,
  EdgeState,
  PointerState,
  CounterSpec,
} from './types.ts';
