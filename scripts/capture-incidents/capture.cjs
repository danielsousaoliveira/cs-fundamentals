// Orchestrates one fault capture: spawn server.js with FAULT=<fault>, drive
// real load against it, poll /metrics once a second, and write the resulting
// time series to captures/<fault>.json. Run once per fault; the memory-leak
// fault is captured separately (see run-memory-leak.sh) because it needs a
// real container memory limit to produce a genuine OOMKill.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FAULT = process.argv[2];
const DURATION_S = Number(process.argv[3] || 25);
const CONCURRENCY = Number(process.argv[4] || 20);
const PORT = 4100;

const FAULT_CONFIG = {
  none: {},
  'load-spike': { POOL_MAX: '25' },
  'slow-dependency': {},
  'cpu-bound': {},
  'pool-exhaustion': { POOL_MAX: '5' },
  'retry-storm': {},
};

if (!(FAULT in FAULT_CONFIG)) {
  console.error(
    `unknown fault: ${FAULT}. Known: ${Object.keys(FAULT_CONFIG).join(', ')}`,
  );
  process.exit(1);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const server = spawn('node', [path.join(__dirname, 'server.cjs')], {
    env: { ...process.env, FAULT, PORT: String(PORT), ...FAULT_CONFIG[FAULT] },
    stdio: 'inherit',
  });

  await sleep(500);

  const load = spawn(
    'node',
    [
      path.join(__dirname, 'load.cjs'),
      `http://127.0.0.1:${PORT}/work`,
      String(CONCURRENCY),
      String(DURATION_S * 1000),
    ],
    { stdio: 'inherit' },
  );

  const samples = [];
  const pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/metrics`);
      const json = await res.json();
      samples.push(json);
      console.log(`[capture:${FAULT}]`, JSON.stringify(json));
    } catch (err) {
      console.error('[capture] poll failed', err.message);
    }
  }, 1000);

  await new Promise((resolve) => load.on('exit', resolve));
  await sleep(1200);
  clearInterval(pollInterval);
  server.kill();

  const outDir = path.join(__dirname, 'captures');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${FAULT}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ fault: FAULT, samples }, null, 2));
  console.log(`wrote ${samples.length} samples to ${outFile}`);
}

main();
