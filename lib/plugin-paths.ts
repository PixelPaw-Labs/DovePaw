import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveAgentsRoot(): string {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
}

const _AGENTS_ROOT = resolveAgentsRoot();
const _DOVEPAW_DIR = join(process.env.HOME!, ".dovepaw");

/** ~/.dovepaw/plugins — installed plugin directories */
export const PLUGINS_DIR = join(_DOVEPAW_DIR, "plugins");
/** ~/.dovepaw/plugins.json — installed plugin registry */
export const PLUGINS_REGISTRY_FILE = join(_DOVEPAW_DIR, "plugins.json");
/** ~/.dovepaw/sdk — deployed @dovepaw/agent-sdk package (used by plugin agents) */
export const AGENT_SDK_DIR = join(_DOVEPAW_DIR, "sdk");
/** DovePaw/packages/agent-sdk — SDK source in the monorepo */
export const AGENT_SDK_SRC = join(_AGENTS_ROOT, "packages/agent-sdk");
