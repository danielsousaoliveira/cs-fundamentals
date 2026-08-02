import type { VizRole } from './types.ts';

const ROLE_LABELS: Partial<Record<VizRole, string>> = {
  active: 'current',
  compare: 'being compared',
  swap: 'swapping',
  sorted: 'settled',
  ghost: 'removed',
};

interface LegendProps {
  /** Roles present in this trace. Pass only what the widget actually uses. */
  roles: VizRole[];
  /** Override or extend the default wording for this widget's vocabulary. */
  labels?: Partial<Record<VizRole, string>>;
}

/** Explains the role colours actually in use — not a fixed key of all of them. */
export function Legend({ roles, labels }: LegendProps) {
  const merged = { ...ROLE_LABELS, ...labels };
  const shown = roles.filter((role) => merged[role]);
  if (shown.length === 0) return null;

  return (
    <ul className="viz-legend">
      {shown.map((role) => (
        <li key={role}>
          <span className="viz-legend__swatch" data-role={role} aria-hidden="true" />
          {merged[role]}
        </li>
      ))}
    </ul>
  );
}
