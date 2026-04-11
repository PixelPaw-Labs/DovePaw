/**
 * CLI entry point for plugin management.
 *
 * Usage:
 *   npm run plugin:add    <source>      — register a plugin from git URL or local path
 *   npm run plugin:remove <name>        — remove a plugin's agent settings from the registry
 *   npm run plugin:list                 — list all installed plugins
 *   npm run plugin:sync   <name>        — re-sync agent settings without a git pull
 *   npm run plugin:update <name>        — git pull + re-sync agent settings
 */

import {
  addPlugin,
  removePlugin,
  listPlugins,
  syncPlugin,
  updatePlugin,
} from "../lib/plugin-manager";

const [subcommand, arg] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (subcommand) {
    case "add": {
      if (!arg) {
        console.error("Usage: npm run plugin:add <git-url-or-local-path>");
        process.exit(1);
      }
      const record = await addPlugin(arg);
      console.log(`Registered plugin "${record.name}" with ${record.agentNames.length} agent(s):`);
      for (const name of record.agentNames) console.log(`  • ${name}`);
      console.log("\nRun  npm run install  to build and deploy the agents.");
      break;
    }
    case "remove": {
      if (!arg) {
        console.error("Usage: npm run plugin:remove <plugin-name>");
        process.exit(1);
      }
      await removePlugin(arg);
      console.log(`Removed plugin "${arg}". Agent settings have been deleted.`);
      break;
    }
    case "list": {
      const plugins = await listPlugins();
      if (plugins.length === 0) {
        console.log("No plugins installed.");
        break;
      }
      for (const p of plugins) {
        console.log(`\n${p.name}  (${p.agentNames.length} agents)`);
        if (p.gitUrl) console.log(`  URL:       ${p.gitUrl}`);
        console.log(`  Path:      ${p.path}`);
        console.log(`  Installed: ${p.installedAt}`);
        console.log(`  Agents:    ${p.agentNames.join(", ")}`);
      }
      break;
    }
    case "sync": {
      if (!arg) {
        console.error("Usage: npm run plugin:sync <plugin-name>");
        process.exit(1);
      }
      const record = await syncPlugin(arg);
      console.log(
        `Synced plugin "${record.name}". ${record.agentNames.length} agent(s) registered.`,
      );
      break;
    }
    case "update": {
      if (!arg) {
        console.error("Usage: npm run plugin:update <plugin-name>");
        process.exit(1);
      }
      const record = await updatePlugin(arg);
      console.log(
        `Updated plugin "${record.name}". ${record.agentNames.length} agent(s) registered.`,
      );
      console.log("\nRun  npm run install  to rebuild and deploy the agents.");
      break;
    }
    default: {
      console.error(`Unknown subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: add, remove, list, sync, update");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
