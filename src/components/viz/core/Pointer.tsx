import { motion } from 'motion/react';
import type { PointerState, VizRole } from './types.ts';

interface PointerProps {
  label: string;
  anchor?: 'above' | 'below';
  role?: VizRole;
}

/**
 * A named arrow: `i`, `j`, `head`, `slow`, `parent`.
 *
 * Rendered inside the target cell's slot rather than absolutely positioned over
 * the strip. That is a deliberate simplification — the flow layout guarantees the
 * arrow can never drift away from the cell it names, which absolute positioning
 * gets wrong the moment the strip wraps or the viewport is narrow.
 *
 * Several pointers on one cell stack instead of overlapping.
 */
export function Pointer({ label, anchor = 'above', role = 'active' }: PointerProps) {
  return (
    <motion.span
      layout
      className="viz-pointer"
      data-anchor={anchor}
      data-role={role}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <span className="viz-pointer__label">{label}</span>
      <span className="viz-pointer__arrow" aria-hidden="true">
        {anchor === 'above' ? '▼' : '▲'}
      </span>
    </motion.span>
  );
}

/** Group a step's pointers by the cell or node they point at. */
export function pointersByTarget(
  pointers: PointerState[] = [],
): Map<string, PointerState[]> {
  const grouped = new Map<string, PointerState[]>();
  for (const pointer of pointers) {
    const existing = grouped.get(pointer.target);
    if (existing) existing.push(pointer);
    else grouped.set(pointer.target, [pointer]);
  }
  return grouped;
}
