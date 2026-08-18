# Incident telemetry capture

Regenerates `src/components/viz/traces/fixtures/incidents.ts`, the data behind
the `IncidentConsole` widget. Every number in that fixture came from here —
a real Node HTTP service (`server.cjs`, zero dependencies), genuinely faulted
six different ways, driven by real concurrent HTTP traffic
(`load.cjs`), sampled once a second from a real `/metrics` endpoint.

## The five faults `capture.cjs` runs directly

```bash
node capture.cjs none 15 15              # baseline
node capture.cjs cpu-bound 15 15
node capture.cjs slow-dependency 15 15
node capture.cjs pool-exhaustion 15 20
node capture.cjs retry-storm 15 15
node capture.cjs load-spike 18 80
```

Each spawns `server.cjs` with `FAULT=<name>`, drives concurrent load against
it, polls `/metrics` every second, and writes `captures/<fault>.json`.

## The memory-leak fault: manual, because it needs a real container memory cap

`cpu-bound` and friends run as plain `node` processes — there's nothing to
cap. Memory-leak needs a genuine kernel OOM-kill, which needs a real
container memory limit:

```bash
docker run -d --name incident-memleak --memory=200m -p 4102:4100 \
  -v "$(pwd)/server.cjs:/app/server.cjs:ro" -w /app \
  -e FAULT=memory-leak -e PORT=4100 \
  node:24-slim node server.cjs

# drive requests slowly enough to see the ramp rather than an instant kill
for i in $(seq 1 60); do curl -s http://127.0.0.1:4102/work >/dev/null; sleep 0.5; done &

# poll every second until the container dies, appending to captures/memory-leak.json
# (see git history of this file for the exact loop used)

docker inspect incident-memleak --format '{{json .State}}'
# {"OOMKilled":true,"ExitCode":137,...}  <- copied verbatim into the fixture
```

The captured fixture includes this `containerState` verbatim — `OOMKilled`
and `ExitCode: 137` are not asserted, they're what `docker inspect` actually
reported.

## Distilling

```bash
node ../distil-incidents.mjs
```

Reads every `captures/*.json`, rounds timestamps to a `t_s` offset from each
fixture's first sample, and writes the typed TS fixture the widget imports.
Raw captures stay out of the shipped bundle, same as
`scripts/distil-query-plans.py` does for query plans.

## Why slow-dependency and cpu-bound are the two that matter most

They produce near-identical p50 latency (~3000ms and ~960ms respectively,
both far above baseline) with opposite CPU signatures — cpu-bound pegs at
100%, slow-dependency sits under 1%. That contrast, measured rather than
described, is the reason `14-production/reading-the-symptoms` exists.
