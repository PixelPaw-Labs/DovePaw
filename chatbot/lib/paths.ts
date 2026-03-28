import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Re-export shared paths so callers can import everything from one place
export {
  AGENTS_ROOT,
  SCHEDULER_ROOT,
  SCHEDULER_LOGS,
  SCHEDULER_STATE,
  SETTINGS_FILE,
  AGENT_SETTINGS_DIR,
  agentSettingsFile,
  agentEntryPath,
  agentLogDir,
  agentStateDir,
  agentEnvScript,
  plistFilePath,
} from "@@/lib/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** agents/chatbot/ */
export const CHATBOT_ROOT = join(__dirname, "..");
/** tsx binary in chatbot's node_modules */
export const TSX_BIN = join(CHATBOT_ROOT, "node_modules/.bin/tsx");
/** Runtime port manifest written by a2a/start-all.ts */
export const PORTS_FILE = join(CHATBOT_ROOT, "a2a/.ports.json");
