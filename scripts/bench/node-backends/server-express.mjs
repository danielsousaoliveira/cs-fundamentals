// Server fixture for the node-backends.mdx benchmark. Requires `express` —
// run `npm install express` in this directory (or anywhere on the path)
// before starting it. Not part of the site's own dependency tree.
//
// Usage: node scripts/bench/node-backends/server-express.mjs [port]

import express from 'express';

const port = Number(process.argv[2] ?? 3000);
const app = express();

app.get('/fast', async (_req, res) => {
  await Promise.resolve();
  res.json({ ok: true });
});

app.get('/block', (_req, res) => {
  const until = Date.now() + 20;
  while (Date.now() < until) {
    // Synchronous busy-loop: occupies the event loop for ~20ms.
  }
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`express listening on ${port}`);
});
