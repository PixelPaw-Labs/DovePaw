#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Deploying agent SDK…"
npx tsx scripts/setup.ts

echo "Compiling…"
npx tsup --config electron/tsup.config.ts

mkdir -p ~/.dovepaw/logs
nohup electron electron/.dist/main.cjs > ~/.dovepaw/logs/electron.log 2>&1 &
ELECTRON_PID=$!
echo "DovePawA2A launched (PID: $ELECTRON_PID) — logs: ~/.dovepaw/logs/electron.log"

# Wait for OpenViking port file (written by main.ts after sidecar is ready)
for i in $(seq 1 40); do
  if [ -f ~/.dovepaw/.openviking-port.json ]; then
    PORT=$(python3 -c "import sys,json; print(json.load(open('$HOME/.dovepaw/.openviking-port.json'))['port'])" 2>/dev/null)
    echo "✓ OpenViking sidecar ready at http://localhost:${PORT}"
    exit 0
  fi
  sleep 1
done
echo "⚠ OpenViking did not start within 40s — check ~/.dovepaw/logs/electron.log"
