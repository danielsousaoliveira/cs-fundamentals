import { describe, expect, it } from 'vitest';
import { RESOURCES, diffResource, renderPlan } from './terraformPlan.ts';

const localFile = RESOURCES.find((r) => r.type === 'local_file')!;
const awsInstance = RESOURCES.find((r) => r.type === 'aws_instance')!;
const awsDb = RESOURCES.find((r) => r.type === 'aws_db_instance')!;

describe('diffResource', () => {
  it('classifies a mutable attribute as an in-place update', () => {
    const diff = diffResource(awsInstance, 'instance_type');
    expect(diff.kind).toBe('update');
  });

  it('classifies a ForceNew attribute as a replacement, captured for real against local_file.file_permission', () => {
    // `terraform plan` against hashicorp/local really does mark this
    // `# forces replacement` -- captured in this repo's scratchpad, not assumed.
    const diff = diffResource(localFile, 'file_permission');
    expect(diff.kind).toBe('replace');
  });

  it('classifies changing the AMI on an EC2 instance as a replacement', () => {
    const diff = diffResource(awsInstance, 'ami');
    expect(diff.kind).toBe('replace');
  });

  it('classifies growing allocated_storage on an RDS instance as in-place', () => {
    const diff = diffResource(awsDb, 'allocated_storage');
    expect(diff.kind).toBe('update');
  });

  it('classifies changing the RDS engine as a replacement -- the dangerous case', () => {
    const diff = diffResource(awsDb, 'engine');
    expect(diff.kind).toBe('replace');
  });

  it('marks exactly one attribute as changed', () => {
    const diff = diffResource(awsInstance, 'subnet_id');
    expect(diff.attributes.filter((a) => a.changed)).toHaveLength(1);
  });

  it('a resource-level replace verb always traces back to a forceNew attribute', () => {
    for (const resource of RESOURCES) {
      for (const attr of resource.attributes) {
        const diff = diffResource(resource, attr.name);
        if (diff.kind === 'replace') {
          expect(diff.attributes.some((a) => a.changed && a.forceNew)).toBe(true);
        } else {
          expect(diff.attributes.some((a) => a.changed && a.forceNew)).toBe(false);
        }
      }
    }
  });
});

describe('renderPlan', () => {
  it('marks a replace with -/+ and the forces-replacement comment', () => {
    const text = renderPlan(diffResource(localFile, 'file_permission'));
    expect(text).toContain('must be replaced');
    expect(text).toContain('-/+ resource');
    expect(text).toContain('forces replacement');
  });

  it('marks an update with ~ and no forces-replacement comment', () => {
    const text = renderPlan(diffResource(awsInstance, 'tags.Name'));
    expect(text).toContain('will be updated in-place');
    expect(text).not.toContain('forces replacement');
  });
});
