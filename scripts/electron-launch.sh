#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Deploying agent SDK…"
npx tsx -e "
import { deployAgentSdk, linkAgentSdkToPlugin } from './lib/installer.js';
import { listPlugins } from './lib/plugin-manager.js';
await deployAgentSdk();
const plugins = await listPlugins();
await Promise.all(plugins.map(p => linkAgentSdkToPlugin(p.path)));
"

echo "Compiling…"
npx tsup --config electron/tsup.config.ts

nohup electron electron/.dist/main.cjs >/dev/null 2>&1 &
echo "DovePawA2A launched (PID: $!)"
