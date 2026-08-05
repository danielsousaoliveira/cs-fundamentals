/**
 * SQL joins, implemented rather than described.
 *
 * The two tables below are small enough to hold in your head and are shaped so
 * that every join trap fires at once:
 *
 *   - **Fan-out.** Department 10 appears twice, so Ana matches two rows. A LEFT
 *     JOIN of four employees returns *five* rows. This is the single most
 *     expensive misunderstanding in the whole topic: people reach for LEFT JOIN
 *     believing it preserves the left table's row count, build a SUM on top of
 *     it, and silently double-count. It does not preserve row count. It
 *     preserves *representation* — every left row appears at least once.
 *   - **NULL never matches.** Cy's `dept_id` is NULL, and NULL = NULL is not
 *     true, it is unknown. Cy is unmatched in an inner join even though the
 *     departments table also contains nothing with a NULL id.
 *   - **Unmatched on both sides.** Di belongs to department 30, which does not
 *     exist; Legal has no employees. Only a FULL OUTER JOIN shows both.
 *
 * The expected outputs in `joins.test.ts` are not my reading of the standard.
 * They were produced by running the equivalent SQL on PostgreSQL 18 and pasting
 * what it printed, so the implementation here is checked against a real engine
 * rather than against my memory of one.
 */

export interface Employee {
  id: number;
  name: string;
  /** NULL is modelled explicitly, because its behaviour is the lesson. */
  deptId: number | null;
}

export interface Department {
  id: number;
  name: string;
}

export const EMPLOYEES: Employee[] = [
  { id: 1, name: 'Ana', deptId: 10 },
  { id: 2, name: 'Bo', deptId: 20 },
  { id: 3, name: 'Cy', deptId: null },
  { id: 4, name: 'Di', deptId: 30 },
];

export const DEPARTMENTS: Department[] = [
  { id: 10, name: 'Engineering' },
  // Deliberately a second row with id 10. Nothing here declares a primary key,
  // which is exactly the situation that produces fan-out in real schemas: a
  // join onto a table that is not unique on the join key.
  { id: 10, name: 'Platform' },
  { id: 20, name: 'Sales' },
  { id: 40, name: 'Legal' },
];

export type JoinKind = 'inner' | 'left' | 'right' | 'full' | 'cross';

export interface JoinRow {
  employee: Employee | null;
  department: Department | null;
  /**
   * Why this row is in the result. `match` means the predicate was true;
   * `padded` means an outer join manufactured NULLs to keep an unmatched row.
   */
  reason: 'match' | 'padded-left' | 'padded-right' | 'cross';
}

/**
 * The join predicate, isolated so the NULL rule has exactly one home.
 *
 * `null == null` is `true` in JavaScript and **unknown** in SQL, so writing the
 * comparison inline would import JavaScript's equality semantics into a widget
 * that claims to teach SQL's. That is not a hypothetical: it would make Cy match
 * nothing in the departments table today, and match a NULL-id department the
 * moment somebody added one, with no test noticing.
 */
export function matches(employee: Employee, department: Department): boolean {
  if (employee.deptId === null) return false;
  return employee.deptId === department.id;
}

export function join(
  kind: JoinKind,
  employees: Employee[] = EMPLOYEES,
  departments: Department[] = DEPARTMENTS,
): JoinRow[] {
  if (kind === 'cross') {
    return employees.flatMap((employee) =>
      departments.map((department) => ({
        employee,
        department,
        reason: 'cross' as const,
      })),
    );
  }

  const rows: JoinRow[] = [];
  const matchedDepartments = new Set<Department>();

  for (const employee of employees) {
    const hits = departments.filter((department) => matches(employee, department));
    for (const department of hits) {
      matchedDepartments.add(department);
      rows.push({ employee, department, reason: 'match' });
    }
    // An unmatched left row survives in LEFT and FULL, padded with NULLs.
    if (hits.length === 0 && (kind === 'left' || kind === 'full')) {
      rows.push({ employee, department: null, reason: 'padded-left' });
    }
  }

  if (kind === 'right' || kind === 'full') {
    for (const department of departments) {
      if (!matchedDepartments.has(department)) {
        rows.push({ employee: null, department, reason: 'padded-right' });
      }
    }
  }

  return rows;
}

/**
 * How many result rows each left row produced.
 *
 * This is the diagnostic for fan-out, and it is worth surfacing directly rather
 * than leaving the reader to count: any left row with a count above 1 is
 * multiplying whatever you aggregate downstream.
 */
export function fanOut(kind: JoinKind): Map<number, number> {
  const counts = new Map<number, number>();
  for (const employee of EMPLOYEES) counts.set(employee.id, 0);
  for (const row of join(kind)) {
    if (row.employee) {
      counts.set(row.employee.id, (counts.get(row.employee.id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Left rows that appear more than once — the rows that will corrupt a SUM. */
export function duplicatedLeftRows(kind: JoinKind): Employee[] {
  const counts = fanOut(kind);
  return EMPLOYEES.filter((employee) => (counts.get(employee.id) ?? 0) > 1);
}

/**
 * What a naive `SUM` over a fanned-out join gets wrong.
 *
 * Each employee has a headcount of exactly 1, so the correct total is the number
 * of employees. Joining first and summing after inflates it by the fan-out, and
 * because the result is still a plausible-looking integer, nothing alerts you.
 */
export function headcountViaJoin(kind: JoinKind): number {
  return join(kind).filter((row) => row.employee !== null).length;
}

export const TRUE_HEADCOUNT = EMPLOYEES.length;
