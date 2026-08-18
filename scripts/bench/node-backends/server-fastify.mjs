// Server fixture for the node-backends.mdx benchmark. Requires `fastify` —
// run `npm install fastify` in this directory (or anywhere on the path)
// before starting it. Not part of the site's own dependency tree.
//
// Usage: node scripts/bench/node-backends/server-fastify.mjs [port]

import Fastify from 'fastify';

const port = Number(process.argv[2] ?? 3001);
const app = Fastify();

app.get('/fast', async () => {
  await Promise.resolve();
  return { ok: true };
});

app.get('/block', async () => {
  const until = Date.now() + 20;
  while (Date.now() < until) {
    // Synchronous busy-loop: occupies the event loop for ~20ms.
  }
  return { ok: true };
});

app.listen({ port }, () => {
  console.log(`fastify listening on ${port}`);
});
