#!/usr/bin/env bash
#
# Regenerate the captured Postgres plan fixture.
#
# Everything the QueryPlanExplorer widget renders, and every plan transcript on
# 8-databases-storage/indexes-and-query-plans, comes out of this script. It is
# committed so the numbers on those pages are reproducible rather than
# remembered: run it against a Postgres 18 instance and you get the fixture back.
#
# Usage:
#   scripts/capture-query-plans.sh > src/components/viz/traces/fixtures/queryPlans.json
#
# It needs a throwaway Postgres. To make one:
#   LC_ALL=C initdb -D /tmp/pgdata -U cs --auth=trust --locale=C
#   pg_ctl -D /tmp/pgdata -o "-p 55432 -k /tmp" -l /tmp/pg.log start
#
# The dataset is deliberately shaped, and the shape is the lesson:
#   * `status` is 92/5/2/1 skewed  -> one index, useful for three values and
#     declined by the planner for the fourth.
#   * `status` and `country` are deterministically anti-correlated -> the
#     planner's independence assumption fails hard enough to be visible.
#   * `amount_cents` is uniform    -> a clean selectivity sweep for the crossover.
set -euo pipefail

PORT="${PGPORT:-55432}"
HOST="${PGHOST:-/tmp}"
PSQL="psql -p $PORT -h $HOST -U cs -d postgres -X -tA -q"

$PSQL -c "DROP TABLE IF EXISTS orders, customers CASCADE" >/dev/null

$PSQL >/dev/null <<'SQL'
CREATE TABLE customers (
  id int PRIMARY KEY, country text NOT NULL,
  signup_date date NOT NULL, tier text NOT NULL
);
CREATE TABLE orders (
  id int PRIMARY KEY, customer_id int NOT NULL, status text NOT NULL,
  amount_cents int NOT NULL, country text NOT NULL, created_at timestamptz NOT NULL
);
INSERT INTO customers SELECT g,
  (ARRAY['PT','ES','FR','DE','GB','US','BR','NL'])[1 + (g::bigint * 7919) % 8],
  DATE '2021-01-01' + (((g::bigint * 104729) % 1600))::int,
  (ARRAY['free','pro','enterprise'])[1 + (g * 31) % 3]
FROM generate_series(1, 20000) g;
INSERT INTO orders SELECT g,
  (1 + (g::bigint * 2654435761) % 20000)::int,
  CASE WHEN g % 100 < 92 THEN 'complete' WHEN g % 100 < 97 THEN 'pending'
       WHEN g % 100 < 99 THEN 'refunded' ELSE 'cancelled' END,
  (100 + (g::bigint * 7919) % 90000)::int,
  (ARRAY['PT','ES','FR','DE','GB','US','BR','NL'])[1 + (g::bigint * 104729) % 8],
  TIMESTAMPTZ '2023-01-01 00:00:00+00' + (g * INTERVAL '54 seconds')
FROM generate_series(1, 500000) g;
ANALYZE customers; ANALYZE orders;
SQL

# VACUUM, not just ANALYZE. An index-only scan is only legal where the
# visibility map says the whole page is visible to everyone, and only VACUUM
# sets that bit. On a freshly bulk-loaded table the map is empty, so Postgres
# will not choose an index-only scan however perfect the index is -- it falls
# back to a bitmap heap scan. Dropping this line silently removes every
# index-only scan from the capture, which is exactly how the first version of
# this script produced a misleading fixture.
$PSQL -c "VACUUM ANALYZE orders" >/dev/null
$PSQL -c "VACUUM ANALYZE customers" >/dev/null

emit_plan() { # sql
  $PSQL -c "EXPLAIN (ANALYZE, BUFFERS, COSTS, FORMAT JSON) $1"
}

echo "{"
echo "  \"capturedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
echo "  \"version\": $($PSQL -c "select to_json(version())"),"
echo "  \"rowCount\": $($PSQL -c 'select count(*) from orders'),"
echo "  \"tableBytes\": $($PSQL -c "select pg_total_relation_size('orders')"),"

# --- matrix: index absent/present x four selectivities -----------------------
echo "  \"matrix\": ["
first=1
for idx in absent present; do
  if [ "$idx" = present ]; then
    $PSQL -c "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)" >/dev/null
  else
    $PSQL -c "DROP INDEX IF EXISTS idx_orders_status" >/dev/null
  fi
  $PSQL -c "VACUUM ANALYZE orders" >/dev/null
  for st in complete pending refunded cancelled; do
    [ $first -eq 0 ] && echo ","
    first=0
    printf '    { "index": "%s", "status": "%s", "plan": %s }' \
      "$idx" "$st" "$(emit_plan "SELECT count(*) FROM orders WHERE status = '$st'")"
  done
done
echo
echo "  ],"

# --- selectivity sweep: where does the planner abandon the index? ------------
# Two curves on the same predicate. `count(*)` can be answered from the index
# alone; `sum(customer_id)` must visit the heap. The crossover differs, and that
# difference is the point.
$PSQL -c "CREATE INDEX IF NOT EXISTS idx_orders_amt ON orders(amount_cents)" >/dev/null
$PSQL -c "VACUUM ANALYZE orders" >/dev/null

echo "  \"sweep\": ["
first=1
for pct in 1 2 5 8 10 12 15 20 25 26 27 28 29 30 40 60; do
  thr=$(( 100 + 90000 * pct / 100 ))
  for q in indexOnly heap; do
    [ "$q" = indexOnly ] && sel="count(*)" || sel="sum(customer_id)"
    [ $first -eq 0 ] && echo ","
    first=0
    printf '    { "pct": %s, "query": "%s", "plan": %s }' \
      "$pct" "$q" "$(emit_plan "SELECT $sel FROM orders WHERE amount_cents < $thr")"
  done
done
echo
echo "  ],"

# --- named scenarios referenced by prose ------------------------------------
echo "  \"scenarios\": {"
$PSQL -c "DROP STATISTICS IF EXISTS stx_status_country" >/dev/null
$PSQL -c "ANALYZE orders" >/dev/null
printf '    "correlatedBefore": %s,\n' \
  "$(emit_plan "SELECT count(*) FROM orders WHERE status = 'cancelled' AND country = 'PT'")"

$PSQL -c "CREATE STATISTICS stx_status_country (dependencies, mcv) ON status, country FROM orders" >/dev/null
$PSQL -c "ANALYZE orders" >/dev/null
printf '    "correlatedAfter": %s,\n' \
  "$(emit_plan "SELECT count(*) FROM orders WHERE status = 'cancelled' AND country = 'PT'")"
$PSQL -c "DROP STATISTICS stx_status_country" >/dev/null

printf '    "functionDefeatsIndex": %s,\n' \
  "$(emit_plan "SELECT count(*) FROM orders WHERE lower(status) = 'cancelled'")"

printf '    "primaryKeyLookup": %s,\n' \
  "$(emit_plan "SELECT * FROM orders WHERE id = 372911")"

printf '    "hashJoin": %s,\n' \
  "$(emit_plan "SELECT c.country, count(*) FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY 1 ORDER BY 2 DESC")"

printf '    "nestedLoop": %s,\n' \
  "$(emit_plan "SELECT o.id, c.country FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'cancelled' AND o.amount_cents > 89000")"

# Index-only scan before and after an UPDATE dirties the visibility map.
$PSQL -c "CREATE INDEX IF NOT EXISTS idx_orders_cust_amt ON orders(customer_id, amount_cents)" >/dev/null
$PSQL -c "VACUUM ANALYZE orders" >/dev/null
printf '    "indexOnlyClean": %s,\n' \
  "$(emit_plan "SELECT sum(amount_cents) FROM orders WHERE customer_id = 4242")"
$PSQL -c "UPDATE orders SET amount_cents = amount_cents WHERE customer_id = 4242" >/dev/null
printf '    "indexOnlyAfterUpdate": %s,\n' \
  "$(emit_plan "SELECT sum(amount_cents) FROM orders WHERE customer_id = 4242")"

# Stale statistics: 500k rows loaded, planner still believes the table is empty.
$PSQL -c "DROP TABLE IF EXISTS fresh" >/dev/null
$PSQL -c "CREATE TABLE fresh AS SELECT * FROM orders WHERE false" >/dev/null
$PSQL -c "ANALYZE fresh" >/dev/null
$PSQL -c "INSERT INTO fresh SELECT * FROM orders" >/dev/null
printf '    "staleStats": %s,\n' \
  "$(emit_plan "SELECT count(*) FROM fresh WHERE status = 'complete'")"
$PSQL -c "ANALYZE fresh" >/dev/null
printf '    "freshStats": %s\n' \
  "$(emit_plan "SELECT count(*) FROM fresh WHERE status = 'complete'")"
$PSQL -c "DROP TABLE fresh" >/dev/null

echo "  },"

echo "  \"indexSizes\": $($PSQL -c "
  SELECT json_agg(json_build_object('name', indexrelname, 'bytes', pg_relation_size(indexrelid)) ORDER BY pg_relation_size(indexrelid) DESC)
  FROM pg_stat_user_indexes WHERE relname='orders'")"
echo "}"
