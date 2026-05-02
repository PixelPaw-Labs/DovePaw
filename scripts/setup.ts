#!/usr/bin/env tsx
import {
  deployAgentSdk,
  linkAgentSdkToAgentLocal,
  linkAgentSdkToPlugin,
  linkLocalAgentSkills,
  syncAgentLocalToSettings,
} from "../lib/installer.js";
import { listPlugins } from "../lib/plugin-manager.js";

await deployAgentSdk();
await linkAgentSdkToAgentLocal();
const plugins = await listPlugins();
await Promise.all([
  ...plugins.map((p) => linkAgentSdkToPlugin(p.path)),
  linkLocalAgentSkills(),
  syncAgentLocalToSettings(),
]);
console.log(`  SDK deployed — linked to ${plugins.length} plugin(s)`);
