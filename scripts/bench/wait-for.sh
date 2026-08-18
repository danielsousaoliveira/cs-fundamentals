#!/bin/sh
# Polls a URL until it responds, so a benchmark run against a just-started
# server doesn't race the process's startup and fail with ECONNREFUSED.
#
# Usage: sh scripts/bench/wait-for.sh <url> [timeoutSeconds]

url="$1"
timeout="${2:-10}"
elapsed=0

until curl -s -o /dev/null "$url"; do
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge $((timeout * 10)) ]; then
    echo "wait-for.sh: $url did not respond within ${timeout}s" >&2
    exit 1
  fi
  sleep 0.1
done
