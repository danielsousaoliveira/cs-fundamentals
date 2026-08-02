import { motion } from 'motion/react';
import { boundsOf, layoutNodes, type LayoutKind } from './layout.ts';
import type { EdgeState, NodeState } from './types.ts';

const RADIUS = 22;

interface GraphCanvasProps {
  nodes: NodeState[];
  edges?: EdgeState[];
  layout?: LayoutKind;
  label?: string;
  hoveredId?: string | null;
  onHoverNode?: (id: string | null) => void;
  /** Show `parent = (i-1)//2`-style index labels beside each node. */
  indexOf?: (id: string) => number | undefined;
}

/**
 * SVG canvas for anything drawn as nodes and edges: binary trees, heaps, general
 * graphs, linked lists, hash-table collision chains.
 *
 * Node positions come from `layout.ts`; this component only renders. Positions
 * animate rather than jump, so a node moving during a rotation or a sift is
 * something you can follow with your eye.
 */
export function GraphCanvas({
  nodes,
  edges = [],
  layout = 'tree',
  label,
  hoveredId,
  onHoverNode,
  indexOf,
}: GraphCanvasProps) {
  const positions = layoutNodes(layout, nodes, edges);
  const { width, height } = boundsOf(positions, RADIUS);

  return (
    <div className="viz-graph">
      {label && <div className="viz-array__label">{label}</div>}
      <svg
        className="viz-graph__svg"
        viewBox={`0 0 ${width} ${height}`}
        // Cap the height so a deep tree scrolls inside its panel instead of
        // pushing the surrounding prose down the page.
        style={{ maxHeight: `${Math.min(height, 340)}px` }}
        role="img"
        aria-label={label ?? 'diagram'}
      >
        <g className="viz-graph__edges">
          {edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;

            return (
              <motion.line
                key={`${edge.from}->${edge.to}`}
                className="viz-edge"
                data-role={edge.role ?? 'default'}
                initial={false}
                animate={{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            );
          })}
        </g>

        <g className="viz-graph__nodes">
          {nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const index = indexOf?.(node.id);

            return (
              <motion.g
                key={node.id}
                className="viz-node"
                data-role={node.role ?? 'default'}
                data-linked={hoveredId === node.id || undefined}
                initial={false}
                animate={{ x: pos.x, y: pos.y }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                onMouseEnter={onHoverNode ? () => onHoverNode(node.id) : undefined}
                onMouseLeave={onHoverNode ? () => onHoverNode(null) : undefined}
              >
                <circle className="viz-node__circle" r={RADIUS} />
                <text className="viz-node__label" dy="0.34em">
                  {node.value}
                </text>
                {index !== undefined && (
                  <text className="viz-node__index" x={RADIUS + 4} y={-RADIUS + 6}>
                    [{index}]
                  </text>
                )}
                {node.annotation && (
                  <text className="viz-node__annotation" y={RADIUS + 14}>
                    {node.annotation}
                  </text>
                )}
              </motion.g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
