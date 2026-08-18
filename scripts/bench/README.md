# Backend runtime benchmarks

Server fixtures and a load generator used to capture the latency and
throughput figures quoted on the `12-backend-apis` pages. These are
standalone scripts, not part of the site's build or its dependency tree —
install each framework locally before running its server.

Captured on Node v24.12.0 / Python 3.9.6, 2026-08-18, concurrency 50
throughout.

Each server is started in the background and needs a moment to bind its
port. `scripts/bench/wait-for.sh` polls the URL until it responds before the
load generator sends its first request — skipping it risks an
`ECONNREFUSED` race against a cold start, especially for gunicorn/uvicorn.

## Node (Express vs Fastify)

```bash
npm install express fastify

node scripts/bench/node-backends/server-express.mjs 3000 &
sh scripts/bench/wait-for.sh http://127.0.0.1:3000/fast
node scripts/bench/load.mjs http://127.0.0.1:3000/fast 500 50
node scripts/bench/load.mjs http://127.0.0.1:3000/block 200 50

node scripts/bench/node-backends/server-fastify.mjs 3001 &
sh scripts/bench/wait-for.sh http://127.0.0.1:3001/fast
node scripts/bench/load.mjs http://127.0.0.1:3001/fast 500 50
```

## Python (Flask/gunicorn vs FastAPI/uvicorn)

```bash
pip install flask gunicorn fastapi 'uvicorn[standard]'

cd scripts/bench/python-backends
gunicorn -w 4 --bind 127.0.0.1:4000 flask_app:app &
uvicorn fastapi_app:app --port 4001 --workers 1 &
cd -

sh scripts/bench/wait-for.sh http://127.0.0.1:4000/fast
sh scripts/bench/wait-for.sh http://127.0.0.1:4001/fast

node scripts/bench/load.mjs http://127.0.0.1:4000/fast 500 50
node scripts/bench/load.mjs http://127.0.0.1:4000/block 200 50

node scripts/bench/load.mjs http://127.0.0.1:4001/fast 500 50
node scripts/bench/load.mjs http://127.0.0.1:4001/block 200 50
node scripts/bench/load.mjs http://127.0.0.1:4001/block-async 200 50
```

`load.mjs` prints wall time, throughput, p50, p99, and max latency for the
given endpoint — the exact numbers quoted in the "Mechanics" and "Cost &
limits" sections of `node-backends.mdx` and `python-backends.mdx` came
straight out of this script.
