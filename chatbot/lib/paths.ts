import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DOVEPAW_DIR, portsFile } from "@@/lib/paths";

// Re-export shared paths so callers can import everything from one place
export {
  AGENTS_ROOT,
  DOVEPAW_DIR,
  DOVEPAW_AGENT_LOGS,
  DOVEPAW_AGENT_STATE,
  SCHEDULER_ROOT,
  SETTINGS_FILE,
  AGENT_SETTINGS_DIR,
  agentDefinitionFile,
  agentEntryPath,
  agentPersistentLogDir,
  agentPersistentStateDir,
  portsFile,
  A2A_SERVERS_PID_FILE,
} from "@@/lib/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** agents/chatbot/ */
export const CHATBOT_ROOT = join(__dirname, "..");
/** tsx binary in root node_modules */
export const TSX_BIN = join(CHATBOT_ROOT, "../node_modules/.bin/tsx");
/** Runtime port manifest written by a2a/start-all.ts. Scoped per Next.js port to allow concurrent instances. */
export const PORTS_FILE = portsFile(process.env.DOVEPAW_PORT ?? "0");
