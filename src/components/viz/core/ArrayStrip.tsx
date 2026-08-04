import { Cell } from './Cell.tsx';
import { Pointer, pointersByTarget } from './Pointer.tsx';
import type { CellState, PointerState } from './types.ts';

interface ArrayStripProps {
  cells: CellState[];
  /** Named arrows (`i`, `head`, …) drawn on the cells they target. */
  pointers?: PointerState[];
  /** Show the `0 1 2 …` index row under the cells. */
  indexLabels?: boolean;
  /**
   * Draw the array as a contiguous run of memory with byte addresses instead of
   * separate boxes. This is the arrays page's whole argument — that an array is
   * one block you index into by arithmetic, which is why a resize has to copy.
   */
  memoryMode?: boolean;
  /** Bytes per element when `memoryMode` is on. */
  stride?: number;
  baseAddress?: number;
  label?: string;
  /** Namespaces `layoutId`s so two strips on one page never fight over identity. */
  idPrefix?: string;
  hoveredId?: string | null;
  onHoverCell?: (id: string | null) => void;
  /** Stack cells vertically — used for the event loop's three queue columns. */
  vertical?: boolean;
}

/**
 * The universal array view: arrays, hash-table buckets, heap backing stores, and
 * (vertically) the event loop's call stack and task queues.
 */
export function ArrayStrip({
  cells,
  pointers = [],
  indexLabels = true,
  memoryMode = false,
  stride = 8,
  baseAddress = 0x1000,
  label,
  idPrefix = '',
  hoveredId,
  onHoverCell,
  vertical = false,
}: ArrayStripProps) {
  // Render in index order regardless of the order the trace happens to list them.
  const ordered = [...cells].sort((a, b) => a.index - b.index);
  const grouped = pointersByTarget(pointers);

  return (
    <div
      className="viz-array"
      data-memory={memoryMode || undefined}
      data-vertical={vertical || undefined}
      /*
       * The strip scrolls horizontally when the array outgrows its container,
       * and a scrollable region that cannot be focused is unreachable by
       * keyboard — a mouse user can drag it, a keyboard user simply cannot see
       * the rest of the array. `tabIndex={0}` makes it focusable so the arrow
       * keys scroll it, and the role/label give screen readers something
       * meaningful to announce when they land on it.
       */
      tabIndex={0}
      role="group"
      aria-label={label ? `${label} (scrollable)` : 'array contents (scrollable)'}
    >
      {label && <div className="viz-array__label">{label}</div>}
      <div className="viz-array__cells">
        {ordered.length === 0 && <span className="viz-array__empty">empty</span>}
        {ordered.map((cell) => {
          const targeting = grouped.get(cell.id) ?? [];
          return (
            <div className="viz-array__slot" key={cell.id}>
              <span className="viz-array__pointers" data-anchor="above">
                {targeting
                  .filter((p) => (p.anchor ?? 'above') === 'above')
                  .map((p) => (
                    <Pointer
                      key={p.label}
                      label={p.label}
                      anchor="above"
                      role={p.role}
                    />
                  ))}
              </span>

              <Cell
                layoutId={`${idPrefix}${cell.id}`}
                value={cell.value}
                role={cell.role}
                index={indexLabels ? cell.index : undefined}
                annotation={cell.annotation}
                address={
                  memoryMode
                    ? `0x${(baseAddress + cell.index * stride).toString(16)}`
                    : undefined
                }
                linked={hoveredId === cell.id}
                onHover={
                  onHoverCell ? (on) => onHoverCell(on ? cell.id : null) : undefined
                }
              />

              <span className="viz-array__pointers" data-anchor="below">
                {targeting
                  .filter((p) => p.anchor === 'below')
                  .map((p) => (
                    <Pointer
                      key={p.label}
                      label={p.label}
                      anchor="below"
                      role={p.role}
                    />
                  ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
