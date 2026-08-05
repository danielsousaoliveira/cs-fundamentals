import { describe, expect, it } from 'vitest';
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
} from './joins.ts';

/**
 * The oracle for this whole file.
 *
 * These are not my expectations — they are what PostgreSQL 18 printed for
 *
 *   SELECT e.id, e.name, e.dept_id, d.id, d.name
 *   FROM employees e <KIND> JOIN departments d ON e.dept_id = d.id
 *   ORDER BY e.id NULLS LAST, d.id NULLS LAST;
 *
 * over exactly the rows in `joins.ts`. Written as `employeeId|departmentName`
 * with `-` for a NULL side. If the implementation and this table disagree, the
 * implementation is wrong, because a real engine produced this.
 */
const POSTGRES_OUTPUT: Record<Exclude<JoinKind, 'cross'>, string[]> = {
  inner: ['1|Engineering', '1|Platform', '2|Sales'],
  left: ['1|Engineering', '1|Platform', '2|Sales', '3|-', '4|-'],
  right: ['1|Engineering', '1|Platform', '2|Sales', '-|Legal'],
  full: ['1|Engineering', '1|Platform', '2|Sales', '3|-', '4|-', '-|Legal'],
};

const render = (kind: JoinKind) =>
  join(kind)
    .map((row) => `${row.employee?.id ?? '-'}|${row.department?.name ?? '-'}`)
    .sort();

describe('matching against PostgreSQL', () => {
  for (const kind of Object.keys(POSTGRES_OUTPUT) as Exclude<JoinKind, 'cross'>[]) {
    it(`reproduces a real ${kind} join exactly`, () => {
      expect(render(kind)).toEqual([...POSTGRES_OUTPUT[kind]].sort());
    });
  }

  it('produces the cartesian product for a cross join', () => {
    // Postgres reported 16 for this data; 4 x 4.
    expect(join('cross')).toHaveLength(EMPLOYEES.length * DEPARTMENTS.length);
    expect(join('cross')).toHaveLength(16);
  });
});

describe('NULL never matches', () => {
  it('excludes the employee with a NULL department from every inner match', () => {
    const cy = EMPLOYEES.find((e) => e.deptId === null)!;
    for (const department of DEPARTMENTS) {
      expect(matches(cy, department)).toBe(false);
    }
  });

  it('would still not match a department with a NULL id', () => {
    // The trap JavaScript sets and SQL does not: `null === null` is true here
    // and unknown there. Guarding on the employee side is what keeps the two
    // languages' semantics apart.
    const cy = EMPLOYEES.find((e) => e.deptId === null)!;
    expect(matches(cy, { id: null as unknown as number, name: 'Unknown' })).toBe(false);
  });

  it('keeps the NULL employee in a left join, padded', () => {
    const row = join('left').find((r) => r.employee?.name === 'Cy')!;
    expect(row.department).toBeNull();
    expect(row.reason).toBe('padded-left');
  });
});

describe('fan-out', () => {
  it('returns more rows than the left table has', () => {
    // The headline. Four employees in, five rows out, from a LEFT JOIN that
    // "keeps all the left rows".
    expect(EMPLOYEES).toHaveLength(4);
    expect(join('left')).toHaveLength(5);
  });

  it('names the row that multiplied', () => {
    expect(duplicatedLeftRows('left').map((e) => e.name)).toEqual(['Ana']);
    expect(fanOut('left').get(1)).toBe(2);
  });

  it('leaves unmatched rows at exactly one', () => {
    const counts = fanOut('left');
    expect(counts.get(3)).toBe(1);
    expect(counts.get(4)).toBe(1);
  });

  it('drops unmatched rows to zero in an inner join', () => {
    const counts = fanOut('inner');
    expect(counts.get(3)).toBe(0);
    expect(counts.get(4)).toBe(0);
    expect(counts.get(1)).toBe(2);
  });

  it('corrupts an aggregate computed after the join', () => {
    // Every employee is one person. Counting after a fanned-out join says
    // otherwise, and the wrong answer is a believable integer -- which is why
    // this reaches production instead of being caught.
    expect(TRUE_HEADCOUNT).toBe(4);
    expect(headcountViaJoin('left')).toBe(5);
    expect(headcountViaJoin('inner')).toBe(3);
  });

  it('is invisible in an inner join on this data, and still wrong', () => {
    // Inner join returns 3 for a 4-person company: one row lost to a NULL, one
    // to a missing department, one gained from fan-out. Two errors in opposite
    // directions partially cancelling is the worst case for spotting it.
    expect(headcountViaJoin('inner')).not.toBe(TRUE_HEADCOUNT);
  });
});

describe('outer padding', () => {
  it('pads only the side that is missing', () => {
    for (const row of join('full')) {
      if (row.reason === 'padded-left') expect(row.department).toBeNull();
      if (row.reason === 'padded-right') expect(row.employee).toBeNull();
      if (row.reason === 'match') {
        expect(row.employee).not.toBeNull();
        expect(row.department).not.toBeNull();
      }
    }
  });

  it('keeps the department nobody works in, in right and full only', () => {
    const hasLegal = (kind: JoinKind) =>
      join(kind).some((r) => r.department?.name === 'Legal');
    expect(hasLegal('right')).toBe(true);
    expect(hasLegal('full')).toBe(true);
    expect(hasLegal('left')).toBe(false);
    expect(hasLegal('inner')).toBe(false);
  });

  it('makes full outer the union of left and right', () => {
    const union = new Set([...render('left'), ...render('right')]);
    expect(render('full')).toEqual([...union].sort());
  });

  it('makes inner the intersection of left and right', () => {
    const left = new Set(render('left'));
    const intersection = render('right').filter((row) => left.has(row));
    expect(render('inner')).toEqual([...new Set(intersection)].sort());
  });
});

describe('row counts', () => {
  it('orders the joins by size the way the data dictates', () => {
    const size = (kind: JoinKind) => join(kind).length;
    expect(size('inner')).toBe(3);
    expect(size('right')).toBe(4);
    expect(size('left')).toBe(5);
    expect(size('full')).toBe(6);
    expect(size('cross')).toBe(16);
    // Inner is never larger than either outer join, and both are never larger
    // than full -- a structural property, not a fact about this data.
    expect(size('inner')).toBeLessThanOrEqual(size('left'));
    expect(size('inner')).toBeLessThanOrEqual(size('right'));
    expect(size('full')).toBeGreaterThanOrEqual(size('left'));
    expect(size('full')).toBeGreaterThanOrEqual(size('right'));
  });

  it('never exceeds the cross join', () => {
    const max = EMPLOYEES.length * DEPARTMENTS.length;
    for (const kind of ['inner', 'left', 'right', 'full'] as JoinKind[]) {
      expect(join(kind).length).toBeLessThanOrEqual(max);
    }
  });
});
