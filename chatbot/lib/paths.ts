import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DOVEPAW_DIR } from "@@/lib/paths";

// Re-export shared paths so callers can import everything from one place
export {
  AGENTS_ROOT,
  DOVEPAW_DIR,
  SCHEDULER_ROOT,
  SCHEDULER_LOGS,
  SCHEDULER_STATE,
  SETTINGS_FILE,
  AGENT_SETTINGS_DIR,
  agentSettingsFile,
  agentEntryPath,
  agentLogDir,
  agentStateDir,
  plistFilePath,
} from "@@/lib/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** agents/chatbot/ */
export const CHATBOT_ROOT = join(__dirname, "..");
/** tsx binary in root node_modules */
export const TSX_BIN = join(CHATBOT_ROOT, "../node_modules/.bin/tsx");
/** Runtime port manifest written by a2a/start-all.ts */
export const PORTS_FILE = join(DOVEPAW_DIR, ".ports.json");
