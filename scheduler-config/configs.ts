import { readScheduledAgentsConfig } from "../lib/agents-config.js";

export type { AgentDef as AgentConfig } from "../lib/agents.js";

export const agents = await readScheduledAgentsConfig();
