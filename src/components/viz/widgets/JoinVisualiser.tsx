import { useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  DEPARTMENTS,
  EMPLOYEES,
  TRUE_HEADCOUNT,
  duplicatedLeftRows,
  fanOut,
  headcountViaJoin,
  join,
  matches,
  type JoinKind,
} from '../traces/joins.ts';

/**
 * Joins, with the fan-out left in.
 *
 * Most join diagrams are Venn diagrams over two sets of *distinct* keys, which
 * makes every join look like set arithmetic and quietly teaches the wrong model.
 * Real joins multiply. The right-hand table here has department 10 twice, so
 * a LEFT JOIN of four employees returns five rows — and once a reader has seen
 * that, "LEFT JOIN preserves my row count" stops being something they believe.
 *
 * The counter at the bottom is the part that matters in production: it shows a
 * headcount computed after the join, next to the true headcount. The wrong
 * number is a plausible integer. That is why this bug ships.
 */

const KINDS: { kind: JoinKind; sql: string }[] = [
  { kind: 'inner', sql: 'INNER JOIN' },
  { kind: 'left', sql: 'LEFT JOIN' },
  { kind: 'right', sql: 'RIGHT JOIN' },
  { kind: 'full', sql: 'FULL OUTER JOIN' },
  { kind: 'cross', sql: 'CROSS JOIN' },
];

const CAPTIONS: Record<JoinKind, string> = {
  inner:
    'Only rows where the predicate is true. Cy has no department, Di’s department does not exist, and Legal has nobody — all three vanish.',
  left: 'Every employee appears at least once. Not exactly once: Ana matches two departments, so four employees produce five rows.',
  right:
    'Every department appears at least once, including Legal, which has no employees. Cy and Di are gone.',
  full: 'Everything from both sides. The only join where an unmatched row on either side survives.',
  cross:
    'Every pairing, predicate ignored: 4 × 4 = 16 rows. This is what a forgotten ON clause gives you.',
};

export function JoinVisualiser() {
  const [kind, setKind] = useState<JoinKind>('inner');

  const rows = join(kind);
  const counts = fanOut(kind);
  const duplicated = duplicatedLeftRows(kind);
  const viaJoin = headcountViaJoin(kind);

  return (
    <VizFrame
      title="Joining two tables that are not unique on the key"
      intro="Department 10 appears twice on purpose. Watch what that does to the row count."
      caption={CAPTIONS[kind]}
    >
      <div className="join__kinds" role="group" aria-label="Join type">
        {KINDS.map(({ kind: k, sql }) => (
          <button
            key={k}
            type="button"
            className={`join__kind${kind === k ? ' join__kind--on' : ''}`}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {sql}
          </button>
        ))}
      </div>

      <div className="join__sources">
        <table className="join__table">
          <caption>employees</caption>
          <thead>
            <tr>
              <th scope="col">id</th>
              <th scope="col">name</th>
              <th scope="col">dept_id</th>
            </tr>
          </thead>
          <tbody>
            {EMPLOYEES.map((employee) => {
              const n = counts.get(employee.id) ?? 0;
              return (
                <tr
                  key={employee.id}
                  className={
                    n === 0
                      ? 'join__row--dropped'
                      : n > 1
                        ? 'join__row--multiplied'
                        : undefined
                  }
                >
                  <td>{employee.id}</td>
                  <td>{employee.name}</td>
                  <td>{employee.deptId ?? <span className="join__null">NULL</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <table className="join__table">
          <caption>departments</caption>
          <thead>
            <tr>
              <th scope="col">id</th>
              <th scope="col">name</th>
            </tr>
          </thead>
          <tbody>
            {DEPARTMENTS.map((department, i) => {
              const used = EMPLOYEES.some((e) => matches(e, department));
              return (
                <tr key={i} className={used ? undefined : 'join__row--dropped'}>
                  <td>{department.id}</td>
                  <td>{department.name}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="join__sql">
        <code>
          SELECT * FROM employees e {KINDS.find((k) => k.kind === kind)!.sql}{' '}
          departments d{kind !== 'cross' && ' ON e.dept_id = d.id'}
        </code>
      </p>

      <div className="join__scroll" tabIndex={0} role="region" aria-label="Join result">
        <table className="join__table join__table--result">
          <caption>
            result — <strong>{rows.length}</strong> rows
          </caption>
          <thead>
            <tr>
              <th scope="col">e.id</th>
              <th scope="col">e.name</th>
              <th scope="col">e.dept_id</th>
              <th scope="col">d.id</th>
              <th scope="col">d.name</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`join__result-row join__result-row--${row.reason}`}
              >
                <td>{row.employee?.id ?? <span className="join__null">NULL</span>}</td>
                <td>
                  {row.employee?.name ?? <span className="join__null">NULL</span>}
                </td>
                <td>
                  {row.employee ? (
                    (row.employee.deptId ?? <span className="join__null">NULL</span>)
                  ) : (
                    <span className="join__null">NULL</span>
                  )}
                </td>
                <td>
                  {row.department?.id ?? <span className="join__null">NULL</span>}
                </td>
                <td>
                  {row.department?.name ?? <span className="join__null">NULL</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>rows returned</dt>
          <dd>
            <span className="viz-counters__value">{rows.length}</span>
            <span className="viz-counters__expected">
              {' '}
              from {EMPLOYEES.length} employees
            </span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>headcount after the join</dt>
          <dd>
            <span
              className={
                viaJoin === TRUE_HEADCOUNT
                  ? 'viz-counters__value'
                  : 'viz-counters__value join__wrong'
              }
            >
              {viaJoin}
            </span>
            <span className="viz-counters__expected">
              {' '}
              true answer {TRUE_HEADCOUNT}
            </span>
          </dd>
        </div>
      </dl>

      {duplicated.length > 0 && (
        <p className="join__warning">
          <strong>{duplicated.map((e) => e.name).join(', ')}</strong>{' '}
          {duplicated.length === 1 ? 'appears' : 'appear'} more than once. Any{' '}
          <code>SUM</code> or <code>COUNT</code> computed after this join is inflated —
          and the wrong answer still looks like a reasonable number.
        </p>
      )}
    </VizFrame>
  );
}
