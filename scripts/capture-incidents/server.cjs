// A minimal HTTP service instrumented for one thing: telemetry a production
// engineer would actually look at. No framework, no npm dependency -- Node's
// built-in http module is enough, and it keeps this script runnable with
// nothing but `node server.js`.
//
// FAULT selects which of six real failure modes the /work endpoint induces.
// Every fault is genuinely happening -- a real setTimeout delay, a real
// crypto hash loop, a real retained array -- not a fabricated metric. See
// each branch below for what it actually does.

const http = require('node:http');
const crypto = require('node:crypto');

const FAULT = process.env.FAULT || 'none';
const PORT = Number(process.env.PORT || 4100);
const DOWNSTREAM_PORT = Number(process.env.DOWNSTREAM_PORT || 4101);

let inFlight = 0;
let completedInWindow = [];
let errorsInWindow = 0;
let requestsInWindow = 0;
const retainedLeak = [];

// A real semaphore-bound worker pool, standing in for a database connection
// pool. It is not literally Postgres -- there is no query planner behind it
// -- but the property under test (a bounded number of concurrent slots, a
// real waiting queue, real queueing delay once the pool is saturated) is
// exactly the property a Postgres connection pool has, and it is measured
// here, not asserted.
class Pool {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.waiting = 0;
  }
  async run(work) {
    if (this.active >= this.max) {
      this.waiting++;
      await new Promise((resolve) => {
        const tryAcquire = () => {
          if (this.active < this.max) {
            this.waiting--;
            resolve();
          } else {
            setTimeout(tryAcquire, 10);
          }
        };
        tryAcquire();
      });
    }
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
}
const pool = new Pool(Number(process.env.POOL_MAX || 5));

let downstream429Count = 0;
let downstreamCallCount = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A real, blocking CPU-bound operation -- SHA-256 over random bytes in a
// tight loop. This occupies the single JS thread for real wall-clock time,
// which is exactly what makes it show up as high CPU and, because Node is
// single-threaded for JS execution, as increased latency for every other
// in-flight request too.
function burnCpu(ms) {
  const end = Date.now() + ms;
  let buf = crypto.randomBytes(64);
  while (Date.now() < end) {
    buf = crypto.createHash('sha256').update(buf).digest();
  }
}

async function handleWork(req, res) {
  inFlight++;
  requestsInWindow++;
  const start = process.hrtime.bigint();
  try {
    if (FAULT === 'cpu-bound') {
      burnCpu(120);
      await pool.run(() => sleep(5));
    } else if (FAULT === 'slow-dependency') {
      // A real async wait, standing in for a slow downstream network call.
      // Nothing here occupies the CPU -- the event loop is free the whole
      // time -- which is the entire point of this fixture existing.
      await sleep(3000);
    } else if (FAULT === 'memory-leak') {
      // Retain a real 5 MB buffer per request, forever. RSS genuinely grows
      // without bound until the container's memory limit kills the process.
      retainedLeak.push(Buffer.alloc(5 * 1024 * 1024, 1));
      await pool.run(() => sleep(5));
    } else if (FAULT === 'pool-exhaustion') {
      await pool.run(() => sleep(2000));
    } else if (FAULT === 'retry-storm') {
      let attempt = 0;
      let ok = false;
      while (attempt < 8 && !ok) {
        attempt++;
        downstreamCallCount++;
        const r = await fetch(`http://127.0.0.1:${DOWNSTREAM_PORT}/flaky`);
        if (r.status === 429) {
          downstream429Count++;
          // Deliberately no backoff -- this is the bug the fixture exists
          // to demonstrate, not a mitigation of it.
          continue;
        }
        ok = true;
      }
      await pool.run(() => sleep(5));
    } else {
      // 'none' / load-spike: baseline work, a small pool-bound op.
      await pool.run(() => sleep(20));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    errorsInWindow++;
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  } finally {
    inFlight--;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    completedInWindow.push(ms);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = process.hrtime.bigint();

function snapshotMetrics() {
  const sorted = [...completedInWindow].sort((a, b) => a - b);
  const cpuNow = process.cpuUsage();
  const timeNow = process.hrtime.bigint();
  const cpuDeltaMicros =
    cpuNow.user - lastCpuUsage.user + (cpuNow.system - lastCpuUsage.system);
  const wallDeltaMicros = Number(timeNow - lastCpuTime) / 1000;
  const cpuPct =
    wallDeltaMicros > 0 ? Math.min(100, (100 * cpuDeltaMicros) / wallDeltaMicros) : 0;
  lastCpuUsage = cpuNow;
  lastCpuTime = timeNow;

  const snapshot = {
    ts: Date.now(),
    rss_mb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    cpu_pct: Math.round(cpuPct * 10) / 10,
    rps: requestsInWindow,
    p50_ms: Math.round(percentile(sorted, 0.5)),
    p95_ms: Math.round(percentile(sorted, 0.95)),
    p99_ms: Math.round(percentile(sorted, 0.99)),
    in_flight: inFlight,
    pool_waiting: pool.waiting,
    error_rate: requestsInWindow > 0 ? errorsInWindow / requestsInWindow : 0,
    downstream_rps: downstreamCallCount,
    downstream_429_rate:
      downstreamCallCount > 0 ? downstream429Count / downstreamCallCount : 0,
  };
  completedInWindow = [];
  errorsInWindow = 0;
  requestsInWindow = 0;
  downstreamCallCount = 0;
  downstream429Count = 0;
  return snapshot;
}

let lastSnapshot = null;
setInterval(() => {
  lastSnapshot = snapshotMetrics();
}, 1000).unref();

const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lastSnapshot || snapshotMetrics()));
    return;
  }
  if (req.url === '/work') {
    handleWork(req, res);
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, () => {
  console.log(`[server] fault=${FAULT} pool_max=${pool.max} listening on ${PORT}`);
});

// The flaky downstream for the retry-storm fixture: a second real HTTP
// listener on the same process, returning 429 a majority of the time.
if (FAULT === 'retry-storm') {
  const downstream = http.createServer((req, res) => {
    if (Math.random() < 0.85) {
      res.writeHead(429);
      res.end();
    } else {
      res.writeHead(200);
      res.end('ok');
    }
  });
  downstream.listen(DOWNSTREAM_PORT, () => {
    console.log(`[downstream] flaky listener on ${DOWNSTREAM_PORT}`);
  });
}
