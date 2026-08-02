import { motion } from 'motion/react';
import type { VizRole, VizValue } from './types.ts';

interface CellProps {
  /** Stable identity — drives the FLIP slide when the cell changes position. */
  layoutId?: string;
  value: VizValue;
  role?: VizRole;
  /** Index label rendered under the cell. */
  index?: number;
  annotation?: string;
  /** Address label for `memoryMode` array strips. */
  address?: string;
  onHover?: (hovering: boolean) => void;
  /** Highlights the cell without changing its role — used for cross-view hover. */
  linked?: boolean;
}

/**
 * The atom. One definition of what a value-in-a-box looks like, in every role,
 * on every page. Array cells, hash buckets, and event-loop queue entries are all
 * this component — which is the point: a reader learns the visual vocabulary once.
 */
export function Cell({
  layoutId,
  value,
  role = 'default',
  index,
  annotation,
  address,
  onHover,
  linked = false,
}: CellProps) {
  return (
    <div
      className="viz-cell-slot"
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {address !== undefined && <span className="viz-cell__address">{address}</span>}
      <motion.div
        layout
        layoutId={layoutId}
        className="viz-cell"
        data-role={role}
        data-linked={linked || undefined}
        transition={{
          type: 'spring',
          stiffness: 420,
          damping: 34,
          // Reduced motion collapses --viz-duration to 0; mirror that here so the
          // layout animation snaps instead of sliding.
          duration: 0.38,
        }}
      >
        {value}
      </motion.div>
      {index !== undefined && <span className="viz-cell__index">{index}</span>}
      {annotation && <span className="viz-cell__annotation">{annotation}</span>}
    </div>
  );
}
