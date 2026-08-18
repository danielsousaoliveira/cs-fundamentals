// Minimal concurrent HTTP load generator used to capture the latency and
// throughput figures quoted on the backend runtime pages. Not part of the
// site build — run it directly with `node scripts/bench/load.mjs <args>`.
//
// Usage:
//   node scripts/bench/load.mjs <url> <totalRequests> <concurrency>

const [, , url, totalArg, concurrencyArg] = process.argv;

if (!url) {
  console.error('usage: node load.mjs <url> <totalRequests> <concurrency>');
  process.exit(1);
}

const total = Number(totalArg ?? 500);
const concurrency = Number(concurrencyArg ?? 50);

const latencies = [];
let completed = 0;
let failed = 0;
let cursor = 0;

async function worker() {
  while (cursor < total) {
    cursor += 1;
    const start = performance.now();
    try {
      const res = await fetch(url);
      if (!res.ok) {
        failed += 1;
        console.error(`  request failed: HTTP ${res.status}`);
        continue;
      }
      await res.json();
      latencies.push(performance.now() - start);
      completed += 1;
    } catch (err) {
      failed += 1;
      console.error(`  request failed: ${err.message}`);
    }
  }
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
const wallMs = Math.round(performance.now() - startedAt);

if (completed === 0) {
  console.error(`  all ${failed} request(s) failed — no latency data captured`);
  process.exit(1);
}

const sorted = [...latencies].sort((a, b) => a - b);

// Throughput is derived from the same rounded wallMs printed below, so the
// two figures are always consistent with each other.
console.log(`${url}  (${total} requests, concurrency ${concurrency})`);
console.log(`  wallMs: ${wallMs}`);
console.log(`  throughput: ${Math.round((completed / wallMs) * 1000)} req/s`);
console.log(`  p50: ${Math.round(percentile(sorted, 50))}ms`);
console.log(`  p99: ${Math.round(percentile(sorted, 99))}ms`);
console.log(`  max: ${Math.round(sorted[sorted.length - 1])}ms`);
if (failed > 0) {
  console.error(
    `  ${failed} request(s) failed — figures above exclude them, run is incomplete`,
  );
  process.exitCode = 1;
}
