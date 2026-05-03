#!/usr/bin/env tsx
import {
  deployAgentSdk,
  linkAgentSdkToAgentLocal,
  linkAgentSdkToPlugin,
  linkLocalAgentSkills,
  syncAgentLocalToSettings,
  syncClaudeRules,
} from "../lib/installer.js";
import { listPlugins } from "../lib/plugin-manager.js";

await deployAgentSdk();
await linkAgentSdkToAgentLocal();
const plugins = await listPlugins();
await Promise.all([
  ...plugins.map((p) => linkAgentSdkToPlugin(p.path)),
  linkLocalAgentSkills(),
  syncAgentLocalToSettings(),
  syncClaudeRules(),
]);
console.log(`  SDK deployed — linked to ${plugins.length} plugin(s)`);
