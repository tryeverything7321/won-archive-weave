#!/bin/sh
set -eu

freshclam --no-warnings
clamd --config-file=/app/clamd.conf &
scanner_pid=$!
trap 'kill "$scanner_pid" 2>/dev/null || true' EXIT INT TERM
attempt=0
until clamdscan --config-file=/app/clamd.conf --ping=1 >/dev/null 2>&1; do
  kill -0 "$scanner_pid"
  attempt=$((attempt + 1))
  [ "$attempt" -lt 120 ]
  sleep 1
done
node src/server.js
