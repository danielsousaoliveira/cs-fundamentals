import { useState } from 'react';
import { VizFrame } from '../core/index.ts';
import {
  CORPUS,
  COSMOS_LIMITS,
  distribute,
  isSinglePartitionQuery,
  KEYS,
  QUERIES,
  throttlingThreshold,
  throughput,
  type KeyName,
} from '../traces/partitioning.ts';

/**
 * Partition keys, scored on both axes at once.
 *
 * The mistake this widget is built to prevent is not "picking a bad key" — it
 * is picking a key by optimising one number. Optimise distribution and you get
 * `/id`, which spreads beautifully and turns every real query into a fan-out.
 * Optimise query locality and you get `/tenantId`, which routes everything
 * perfectly into one partition holding 47% of the data.
 *
 * So both columns are always on screen, and the reader can watch them fight.
 * There is no row that wins both, which is the honest shape of the decision.
 *
 * The distributions are computed by hashing the corpus with FNV-1a at render
 * time — nothing is pre-baked. The RU/s and storage ceilings are Azure's, quoted
 * with their source and date, because this file cannot verify them.
 */

const RU_CHOICES = [4000, 10_000, 40_000];

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function PartitionKeyExplorer() {
  const [key, setKey] = useState<KeyName>('tenantId');
  const [provisioned, setProvisioned] = useState(10_000);

  const dist = distribute(key);
  const verdict = throughput(dist, provisioned);
  const peak = Math.max(...dist.partitions.map((p) => p.docs), 1);
  const threshold = throttlingThreshold(dist);

  const routable = QUERIES.filter((q) => isSinglePartitionQuery(key, q.filters)).length;

  return (
    <VizFrame
      title="Choosing a partition key"
      intro={`${CORPUS.length.toLocaleString()} documents hashed across 12 physical partitions. One tenant is 45% of the data and 60% of writes land on the newest day — the shape every real dataset has.`}
      caption={
        verdict.throttled
          ? `The busiest partition wants ${Math.round(verdict.hottestDemand).toLocaleString()} RU/s but is allotted ${Math.round(verdict.perPartition).toLocaleString()}. You are throttled while using ${pct(verdict.usableFraction)} of what you provisioned — and the container-level metric looks fine.`
          : `Load is even enough that every partition stays within its ${Math.round(verdict.perPartition).toLocaleString()} RU/s share. ${pct(verdict.usableFraction)} of the provisioned throughput is reachable.`
      }
      footer={
        <span className="plan__provenance">
          Limits from{' '}
          <a href={COSMOS_LIMITS.url} rel="nofollow noopener">
            {COSMOS_LIMITS.source}
          </a>
          , page updated {COSMOS_LIMITS.documentUpdated}, read {COSMOS_LIMITS.readOn}.
          Quotas change — check before relying on them.
        </span>
      }
    >
      <div className="plan__controls">
        <fieldset className="plan__field">
          <legend>partition key</legend>
          <div className="plan__segmented" role="group">
            {KEYS.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                className={`plan__seg${key === candidate.name ? ' plan__seg--on' : ''}`}
                aria-pressed={key === candidate.name}
                onClick={() => setKey(candidate.name)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="plan__field">
          <legend>provisioned RU/s</legend>
          <div className="plan__segmented" role="group">
            {RU_CHOICES.map((ru) => (
              <button
                key={ru}
                type="button"
                className={`plan__seg${provisioned === ru ? ' plan__seg--on' : ''}`}
                aria-pressed={provisioned === ru}
                onClick={() => setProvisioned(ru)}
              >
                {ru.toLocaleString()}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <ol className="part__bars" aria-label="Documents per physical partition">
        {dist.partitions.map((partition) => {
          const share = partition.docs / CORPUS.length;
          const over = share * provisioned > verdict.perPartition;
          return (
            <li key={partition.index} className="part__row">
              <span className="part__label">p{partition.index}</span>
              <span className="part__track">
                <span
                  className={`part__bar${over ? ' part__bar--hot' : ''}${partition.docs === 0 ? ' part__bar--idle' : ''}`}
                  style={{ width: `${(partition.docs / peak) * 100}%` }}
                />
              </span>
              <span className="part__count">
                {partition.docs === 0 ? (
                  <em>idle</em>
                ) : (
                  <>
                    {partition.docs} <small>{pct(share)}</small>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <dl className="viz-counters">
        <div className="viz-counters__item">
          <dt>distinct key values</dt>
          <dd>
            <span className="viz-counters__value">{dist.cardinality}</span>
            <span className="viz-counters__expected">
              {' '}
              → {dist.used}/12 partitions used
            </span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>skew</dt>
          <dd>
            <span
              className={`viz-counters__value${dist.skew > 2 ? ' join__wrong' : ''}`}
            >
              {dist.skew.toFixed(2)}×
            </span>
            <span className="viz-counters__expected"> 1.0 is even</span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>throughput usable</dt>
          <dd>
            <span
              className={`viz-counters__value${verdict.usableFraction < 0.5 ? ' join__wrong' : ''}`}
            >
              {pct(verdict.usableFraction)}
            </span>
            <span className="viz-counters__expected">
              {' '}
              of {provisioned.toLocaleString()} RU/s
            </span>
          </dd>
        </div>
        <div className="viz-counters__item">
          <dt>queries routable</dt>
          <dd>
            <span
              className={`viz-counters__value${routable === 0 ? ' join__wrong' : ''}`}
            >
              {routable}
            </span>
            <span className="viz-counters__expected"> of {QUERIES.length}</span>
          </dd>
        </div>
      </dl>

      {/*
        The second axis. Without it the widget would teach "maximise
        cardinality", which produces /id -- a key Microsoft's own documentation
        lists as an anti-pattern for general workloads.
      */}
      <div className="part__queries">
        <h4>Can a query find its partition, or must it ask all twelve?</h4>
        <ul>
          {QUERIES.map((query) => {
            const routed = isSinglePartitionQuery(key, query.filters);
            return (
              <li
                key={query.label}
                className={routed ? 'part__query--routed' : 'part__query--fanout'}
              >
                <span>{query.label}</span>
                <strong>{routed ? 'one partition' : 'all 12 partitions'}</strong>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="part__ceiling">
        A single logical partition is capped at{' '}
        <strong>
          {COSMOS_LIMITS.physicalPartitionRuPerSecond.toLocaleString()} RU/s
        </strong>{' '}
        and <strong>{COSMOS_LIMITS.logicalPartitionBytes / 1024 ** 3} GB</strong>. With
        this key the hottest partition hits the RU ceiling once the container is
        provisioned past roughly{' '}
        <strong>
          {Math.round(threshold / 100) * 100 === 0
            ? '—'
            : Math.round(threshold).toLocaleString()}{' '}
          RU/s
        </strong>
        . Past that point <em>buying more throughput does not help</em>: the cap is per
        partition, and one key value cannot be split across two.
      </p>
    </VizFrame>
  );
}
