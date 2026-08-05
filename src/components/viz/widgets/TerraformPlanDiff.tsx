import { useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  RESOURCES,
  diffResource,
  renderPlan,
  type ChangeKind,
} from '../traces/terraformPlan.ts';

/**
 * Pick which attribute to edit, watch the plan verb flip.
 *
 * The point this widget exists to make: the diff does not scale with how big
 * the edit looks. Renaming a tag is one line and an in-place update. Changing
 * one character of an AMI id is also one line, and it is a destroy-and-recreate
 * of the instance. The only way to know which you are looking at is the
 * schema — `ForceNew` or not — which is exactly what this widget surfaces
 * instead of leaving it implicit in a wall of diff output.
 */

const KIND_LABEL: Record<ChangeKind, string> = {
  'no-op': 'no changes',
  update: 'update in-place',
  replace: 'destroy and recreate',
};

export function TerraformPlanDiff() {
  const [resourceIndex, setResourceIndex] = useState(1);
  const resource = RESOURCES[resourceIndex]!;
  const [attrName, setAttrName] = useState(resource.attributes[0]!.name);

  const attr =
    resource.attributes.find((a) => a.name === attrName) ?? resource.attributes[0]!;
  const diff = diffResource(resource, attr.name);
  const plan = renderPlan(diff);

  function selectResource(index: number) {
    setResourceIndex(index);
    setAttrName(RESOURCES[index]!.attributes[0]!.name);
  }

  return (
    <VizFrame
      title="Editing one attribute at a time"
      intro="Same shape of edit, one line changed. The verb Terraform picks depends on the schema, not on how the edit looks."
      caption={
        diff.kind === 'replace'
          ? `${attr.name} is ForceNew on ${resource.type} -- changing it destroys the resource and creates a new one with a new id.`
          : diff.kind === 'update'
            ? `${attr.name} is mutable on ${resource.type} -- Terraform updates it in place, same id, same resource.`
            : 'Pick an attribute to change.'
      }
    >
      <div className="tfplan__resources" role="group" aria-label="Resource">
        {RESOURCES.map((r, i) => (
          <button
            key={r.type}
            type="button"
            className={`tfplan__resource${i === resourceIndex ? ' tfplan__resource--on' : ''}`}
            aria-pressed={i === resourceIndex}
            onClick={() => selectResource(i)}
          >
            {r.type}
          </button>
        ))}
      </div>

      <div className="tfplan__attrs" role="group" aria-label="Attribute to change">
        {resource.attributes.map((a) => (
          <button
            key={a.name}
            type="button"
            className={`tfplan__attr${a.name === attrName ? ' tfplan__attr--on' : ''}${
              a.forceNew ? ' tfplan__attr--forcenew' : ''
            }`}
            aria-pressed={a.name === attrName}
            onClick={() => setAttrName(a.name)}
          >
            {a.name}
            {a.forceNew && <span className="tfplan__badge">ForceNew</span>}
          </button>
        ))}
      </div>

      <pre className="tfplan__plan" aria-label="terraform plan output">
        <code>{plan}</code>
      </pre>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>plan verb</dt>
          <dd>
            <span
              className={
                diff.kind === 'replace'
                  ? 'viz-counters__value tfplan__verb--replace'
                  : 'viz-counters__value'
              }
            >
              {KIND_LABEL[diff.kind]}
            </span>
          </dd>
        </div>
      </dl>

      {diff.kind === 'replace' && (
        <p className="tfplan__warning">
          The plan is one changed line either way. Nothing about the size of the edit
          signals a replacement — only the schema does, and the schema isn&apos;t in the
          diff you&apos;re looking at unless the CLI prints the comment.
        </p>
      )}
    </VizFrame>
  );
}
