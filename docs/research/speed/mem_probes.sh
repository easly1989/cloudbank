#!/usr/bin/env bash
# Runs mem_probe.py once per endpoint, each on a freshly started server over
# the seeded 100k wallet of ../sqlite-load. Stop any server on the port first.
# Windows (Git Bash) only: it reads the server's PID and memory through
# PowerShell. See ../speed-baseline.md.
#   bash mem_probes.sh   → out/mem-probes.jsonl
set -euo pipefail
cd "$(dirname "$0")"
PORT=8097
LOAD=../sqlite-load/out
mkdir -p out
: > out/mem-probes.jsonl
for key in dashboard-12m dashboard-0m dashboard-default accounts review register; do
  CB_DATA_DIR=$LOAD/data CB_SECURE_COOKIES=false CB_ADDR=127.0.0.1:$PORT "$LOAD/cloudbank.exe" > out/probe-server.log 2>&1 &
  until curl -sf "http://127.0.0.1:$PORT/healthz" > /dev/null; do sleep 0.3; done
  pid=$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $PORT -State Listen).OwningProcess" | tr -d '\r')
  python mem_probe.py "http://127.0.0.1:$PORT" "$pid" "$LOAD/creds.json" "$key" | tee -a out/mem-probes.jsonl
  powershell -NoProfile -Command "Stop-Process -Id $pid"
  wait || true
done
