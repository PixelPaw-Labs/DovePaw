#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Deploying agent SDK…"
npx tsx scripts/setup.ts

echo "Compiling…"
npx tsup --config electron/tsup.config.ts

nohup electron electron/.dist/main.cjs >/dev/null 2>&1 &
echo "DovePawA2A launched (PID: $!)"
