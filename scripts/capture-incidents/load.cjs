// A real concurrent HTTP load driver against a real server -- no mocked
// traffic. Fires `concurrency` requests in flight at all times against
// `url` for `durationMs`, using Node's built-in fetch.

const url = process.argv[2];
const concurrency = Number(process.argv[3] || 10);
const durationMs = Number(process.argv[4] || 20000);

async function worker(deadline) {
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      // Connection errors are expected once a fault genuinely saturates
      // the server -- the point is real traffic, not guaranteed success.
    }
  }
}

async function main() {
  const deadline = Date.now() + durationMs;
  const workers = Array.from({ length: concurrency }, () => worker(deadline));
  await Promise.all(workers);
}

main();
