#!/usr/bin/env tsx
import { deployAgentSdk, linkAgentSdkToPlugin } from "../lib/installer.js";
import { listPlugins } from "../lib/plugin-manager.js";

await deployAgentSdk();
const plugins = await listPlugins();
await Promise.all(plugins.map((p) => linkAgentSdkToPlugin(p.path)));
console.log(`  SDK deployed — linked to ${plugins.length} plugin(s)`);
