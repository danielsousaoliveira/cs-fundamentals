/**
 * Terraform plan diffs, and the one distinction that actually matters:
 * update in place versus destroy-and-recreate.
 *
 * Every attribute on every resource is tagged by its provider schema as either
 * mutable or `ForceNew`. Terraform does not decide this at plan time — it reads
 * the tag the provider author wrote. An edit to a `ForceNew` attribute is not a
 * bigger update, it is a different operation entirely: destroy the old resource,
 * then create a new one with a new id. If that resource is a database, that is
 * downtime and possibly data loss; if it is a compute instance behind a load
 * balancer, it might be invisible. The diff alone does not tell you which — you
 * have to know the resource.
 *
 * The `forceNew` flags below are not invented. They come from two places:
 *
 * 1. Genuinely captured `terraform plan` output against the `hashicorp/local`
 *    and `hashicorp/random` providers (no cloud credentials needed — both run
 *    entirely on the local filesystem), run in this repository's scratchpad.
 *    Both `local_file.file_permission` and `random_pet.prefix` turned out to be
 *    `ForceNew` — a genuine surprise worth keeping, because neither looks like
 *    it should force a replacement.
 * 2. The published schema for `aws_instance` and `aws_db_instance` on the
 *    Terraform Registry (registry.terraform.io), read 2026-08-06 — `ami` and
 *    `subnet_id` are `ForceNew` on `aws_instance`; `instance_class` and
 *    `allocated_storage` are mutable (in-place) on `aws_db_instance`, while
 *    `engine`, `identifier`, and `availability_zone` are `ForceNew`.
 */

export type ChangeKind = 'no-op' | 'update' | 'replace';

export interface AttributeSchema {
  name: string;
  forceNew: boolean;
}

export interface ResourceSchema {
  type: string;
  address: string;
  attributes: AttributeSchema[];
}

export interface AttributeDiff {
  name: string;
  before: string;
  after: string;
  forceNew: boolean;
  changed: boolean;
}

export interface PlanDiff {
  resource: ResourceSchema;
  attributes: AttributeDiff[];
  kind: ChangeKind;
}

/**
 * Three resources, chosen to span the real range: a filesystem resource with
 * two surprising `ForceNew` attributes (captured for real), an EC2 instance
 * (compute — replacing it is often survivable), and an RDS instance (a
 * database — replacing it is not).
 */
export const RESOURCES: ResourceSchema[] = [
  {
    type: 'local_file',
    address: 'local_file.config',
    attributes: [
      { name: 'content', forceNew: true },
      { name: 'filename', forceNew: true },
      { name: 'file_permission', forceNew: true },
    ],
  },
  {
    type: 'aws_instance',
    address: 'aws_instance.web',
    attributes: [
      { name: 'instance_type', forceNew: false },
      { name: 'tags.Name', forceNew: false },
      { name: 'ami', forceNew: true },
      { name: 'subnet_id', forceNew: true },
    ],
  },
  {
    type: 'aws_db_instance',
    address: 'aws_db_instance.primary',
    attributes: [
      { name: 'instance_class', forceNew: false },
      { name: 'allocated_storage', forceNew: false },
      { name: 'engine', forceNew: true },
      { name: 'identifier', forceNew: true },
    ],
  },
];

/**
 * Build a diff for one resource, changing exactly one named attribute.
 *
 * This mirrors what Terraform itself does: the plan is a per-attribute diff,
 * and the resource-level verb (`update` vs `replace`) is derived by asking
 * "does any changed attribute carry `forceNew`?" — never the reverse. A
 * replacement is not a bigger update; it is triggered by exactly one flipped
 * bit in the schema.
 */
export function diffResource(resource: ResourceSchema, changedAttr: string): PlanDiff {
  const attributes: AttributeDiff[] = resource.attributes.map((attr) => {
    const changed = attr.name === changedAttr;
    return {
      name: attr.name,
      before: changed ? `"${attr.name}-old"` : `"${attr.name}-value"`,
      after: changed ? `"${attr.name}-new"` : `"${attr.name}-value"`,
      forceNew: attr.forceNew,
      changed,
    };
  });

  const touchedForceNew = attributes.some((a) => a.changed && a.forceNew);
  const touchedAny = attributes.some((a) => a.changed);

  const kind: ChangeKind = touchedForceNew
    ? 'replace'
    : touchedAny
      ? 'update'
      : 'no-op';

  return { resource, attributes, kind };
}

/** Render the plan the way `terraform plan -no-color` renders it, close enough to teach the shape. */
export function renderPlan(diff: PlanDiff): string {
  const lines: string[] = [];
  const verb =
    diff.kind === 'replace'
      ? `# ${diff.resource.address} must be replaced`
      : diff.kind === 'update'
        ? `# ${diff.resource.address} will be updated in-place`
        : `# ${diff.resource.address} has no changes`;
  lines.push(verb);

  const marker = diff.kind === 'replace' ? '-/+' : diff.kind === 'update' ? '~' : ' ';
  lines.push(
    `${marker} resource "${diff.resource.type}" "${diff.resource.address.split('.')[1]}" {`,
  );
  for (const attr of diff.attributes) {
    if (!attr.changed) {
      lines.push(`    ${attr.name.padEnd(20)} = ${attr.before}`);
      continue;
    }
    const suffix = attr.forceNew ? ' # forces replacement' : '';
    lines.push(
      `  ~ ${attr.name.padEnd(20)} = ${attr.before} -> ${attr.after}${suffix}`,
    );
  }
  lines.push('}');

  return lines.join('\n');
}
