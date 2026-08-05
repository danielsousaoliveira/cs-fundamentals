import { useMemo, useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  CAPTURED,
  crossover,
  estimateError,
  flatten,
  isDegradedIndexOnly,
  matrixCell,
  scanNode,
  speedup,
  STATUS_SHARE,
  totalRows,
  usesIndex,
  type IndexState,
  type StatusValue,
} from '../traces/queryPlan.ts';

/**
 * The plan explorer for `indexes-and-query-plans`.
 *
 * It exists to make one specific belief falsifiable. Almost everyone arrives
 * believing that adding an index makes a query faster, and that a slow query
 * means a missing index. Both are false, and prose bounces off them — "it
 * depends on selectivity" is heard as a hedge rather than as a rule.
 *
 * So: same query, same table, same index. Change only the *value* being matched
 * and watch the planner reverse its decision, with the real timings and real
 * buffer counts attached. At 92% selectivity the index is present, applicable,
 * and correctly ignored. At 1% it is a 27x speedup. Nothing about the index
 * changed between those two runs.
 *
 * Everything rendered here was captured from PostgreSQL 18 by
 * `scripts/capture-query-plans.sh`. There is no cost model in this file and no
 * simulated planner — a simulated one would have agreed with whatever the prose
 * claimed, which is exactly the failure this site is built to avoid.
 */

const STATUSES: StatusValue[] = ['complete', 'pending', 'refunded', 'cancelled'];

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function ms(n: number): string {
  return `${n.toFixed(2)} ms`;
}

/** Buffers are 8 KB blocks; readers think in MB. */
function mb(blocks: number): string {
  const bytes = blocks * 8192;
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

export function QueryPlanExplorer() {
  const [index, setIndex] = useState<IndexState>('absent');
  const [status, setStatus] = useState<StatusValue>('complete');

  const cell = matrixCell(index, status);
  const rows = useMemo(() => flatten(cell), [index, status]);
  const scan = scanNode(cell);
  const indexed = usesIndex(cell);
  const gain = speedup(status);

  const heapCrossover = crossover('heap');

  const caption = !indexed
    ? index === 'present'
      ? `The index exists and Postgres declined it. ${pct(STATUS_SHARE[status])} of the table matches, so reading every row in physical order beats ${(
          STATUS_SHARE[status] * CAPTURED.rowCount
        ).toLocaleString()} random jumps into the heap.`
      : `No index on status, so there is nothing to choose: every row is read and ${scan.rowsRemoved?.toLocaleString() ?? 'most'} per worker are thrown away.`
    : `Only ${pct(STATUS_SHARE[status])} of rows match, so the index wins — ${gain.toFixed(
        1,
      )}x faster than the same query without it, touching ${mb(scan.buffers)} instead of ${mb(
        4160,
      )}.`;

  return (
    <VizFrame
      title="The same index, used and refused"
      intro={`Real EXPLAIN (ANALYZE, BUFFERS) output from PostgreSQL 18 over ${CAPTURED.rowCount.toLocaleString()} rows. Change the value, not the index.`}
      caption={caption}
      footer={
        <span className="plan__provenance">
          Captured {CAPTURED.capturedAt.slice(0, 10)} ·{' '}
          {CAPTURED.version.replace(/ \(.*/, '')} · timings are from one machine; the
          node types and buffer counts are the parts that reproduce.
        </span>
      }
    >
      <div className="plan__controls">
        <fieldset className="plan__field">
          <legend>index on status</legend>
          <div className="plan__segmented" role="group">
            {(['absent', 'present'] as IndexState[]).map((state) => (
              <button
                key={state}
                type="button"
                className={`plan__seg${index === state ? ' plan__seg--on' : ''}`}
                aria-pressed={index === state}
                onClick={() => setIndex(state)}
              >
                {state === 'absent' ? 'no index' : 'CREATE INDEX'}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="plan__field">
          <legend>WHERE status =</legend>
          <div className="plan__segmented" role="group">
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                className={`plan__seg${status === value ? ' plan__seg--on' : ''}`}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value}
                <small>{pct(STATUS_SHARE[value])}</small>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <p className="plan__sql">
        <code>SELECT count(*) FROM orders WHERE status = &apos;{status}&apos;</code>
      </p>

      <div className={`plan__verdict${indexed ? ' plan__verdict--index' : ''}`}>
        <strong>{scan.nodeType}</strong>
        <span>
          {indexed
            ? 'index used'
            : index === 'present'
              ? 'index available, not used'
              : 'no index available'}
        </span>
      </div>

      <ol className="plan__tree" tabIndex={0} aria-label="Query plan tree">
        {rows.map((row, i) => (
          <li
            key={i}
            className="plan__node"
            style={{ paddingInlineStart: `${row.depth * 1.1}rem` }}
          >
            <span className="plan__node-head">
              <span className="plan__node-type">{row.node.nodeType}</span>
              {row.node.indexName && (
                <span className="plan__node-index">using {row.node.indexName}</span>
              )}
              <span
                className="plan__node-share"
                style={{
                  ['--share' as string]: `${(row.selfShare * 100).toFixed(1)}%`,
                }}
                title={`${(row.selfShare * 100).toFixed(1)}% of this query's time`}
              />
            </span>

            <span className="plan__node-facts">
              <span>
                est <strong>{row.node.estRows.toLocaleString()}</strong> · actual{' '}
                <strong>{Math.round(row.node.actualRows).toLocaleString()}</strong>
                {row.node.loops > 1 && (
                  <em>
                    {' '}
                    ×{row.node.loops} loops = {totalRows(row.node).toLocaleString()}
                  </em>
                )}
              </span>
              {row.node.buffers > 0 && <span>{mb(row.node.buffers)} read</span>}
              {row.node.rowsRemoved !== undefined && (
                <span className="plan__waste">
                  {row.node.rowsRemoved.toLocaleString()} rows discarded
                </span>
              )}
              {row.node.heapFetches !== undefined && (
                <span
                  className={isDegradedIndexOnly(row.node) ? 'plan__waste' : undefined}
                >
                  {row.node.heapFetches} heap fetches
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>execution</dt>
          <dd>
            <span className="viz-counters__value">{ms(cell.executionMs)}</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>data touched</dt>
          <dd>
            <span className="viz-counters__value">{mb(scan.buffers)}</span>
            <span className="viz-counters__expected"> of 43 MB</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>estimate error</dt>
          <dd>
            <span className="viz-counters__value">
              {estimateError(scan).toFixed(2)}×
            </span>
          </dd>
        </div>
      </dl>

      {/*
        The sweep is shown alongside rather than as a separate widget because
        the matrix above can be misread as "indexes are for rare values". The
        two curves say something sharper: the index-only curve never crosses at
        all, so the familiar "indexes stop paying past ~10% selectivity" rule is
        really a rule about touching the heap.
      */}
      <div className="plan__sweep">
        <h4>Where does the planner give up on the index?</h4>
        <div
          className="plan__sweep-scroll"
          tabIndex={0}
          role="region"
          aria-label="Selectivity sweep"
        >
          <table className="plan__sweep-table">
            <thead>
              <tr>
                <th scope="col">rows matched</th>
                <th scope="col">
                  <code>count(*)</code> — answerable from the index
                </th>
                <th scope="col">
                  <code>sum(customer_id)</code> — must read the table
                </th>
              </tr>
            </thead>
            <tbody>
              {[1, 10, 20, 25, 28, 29, 40, 60].map((p) => {
                const io = CAPTURED.sweep.find(
                  (s) => s.query === 'indexOnly' && s.pct === p,
                )!;
                const heap = CAPTURED.sweep.find(
                  (s) => s.query === 'heap' && s.pct === p,
                )!;
                return (
                  <tr key={p}>
                    <th scope="row">{p}%</th>
                    <td
                      className={
                        usesIndex(io) ? 'plan__cell--index' : 'plan__cell--seq'
                      }
                    >
                      {scanNode(io).nodeType} · {ms(io.executionMs)}
                    </td>
                    <td
                      className={
                        usesIndex(heap) ? 'plan__cell--index' : 'plan__cell--seq'
                      }
                    >
                      {scanNode(heap).nodeType} · {ms(heap.executionMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="plan__sweep-note">
          The heap-reading query abandons the index between{' '}
          <strong>
            {heapCrossover?.lastIndexedPct}% and {heapCrossover?.firstSeqPct}%
          </strong>
          . The index-only query never abandons it — not even at 60%.
        </p>
      </div>
    </VizFrame>
  );
}
