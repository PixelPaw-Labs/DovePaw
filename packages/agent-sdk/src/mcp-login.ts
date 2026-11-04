import { spawn } from "node:child_process";
import { exec } from "./exec.js";

export type McpCli = "claude" | "codex";

export type McpServerStatus = "connected" | "needs-auth" | "other";

export interface McpServerState {
  name: string;
  status: McpServerStatus;
}

export const DEFAULT_MCP_LOGIN_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const RETRY_DELAY_MS = 5_000;

/** Parse the text output of `claude mcp list` (one `<name>: <target> - <status>` line per server). */
export function parseClaudeMcpList(output: string): McpServerState[] {
  return output.split("\n").flatMap((line) => {
    const statusSep = line.lastIndexOf(" - ");
    if (statusSep === -1) return [];
    const head = line.slice(0, statusSep);
    const nameSep = head.lastIndexOf(": ");
    if (nameSep === -1) return [];
    const statusText = line.slice(statusSep + 3);
    const status: McpServerStatus = statusText.includes("Needs authentication")
      ? "needs-auth"
      : statusText.includes("Connected")
        ? "connected"
        : "other";
    return [{ name: head.slice(0, nameSep).trim(), status }];
  });
}

/** Parse `codex mcp list --json`. Codex only reports whether a login is stored, not whether it expired. */
export function parseCodexMcpList(json: string): McpServerState[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const name: unknown = Reflect.get(entry, "name");
    if (typeof name !== "string") return [];
    const authStatus: unknown = Reflect.get(entry, "auth_status");
    const status: McpServerStatus = authStatus === "not_logged_in" ? "needs-auth" : "connected";
    return [{ name, status }];
  });
}

/**
 * A required name matches a configured server by its full name or by the part after the
 * last ":", so `sumo-logic` matches Claude's `plugin:sumologic:sumo-logic` and Codex's `sumo-logic`.
 */
export function mcpServerMatches(required: string, actual: string): boolean {
  return actual === required || actual.split(":").at(-1) === required;
}

/** Read the comma-separated required server names DovePaw injects from agent.json. */
export function readRequiredMcpServers(env: Record<string, string | undefined> = process.env) {
  return (env.DOVEPAW_REQUIRED_MCP_SERVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function listMcpServers(cli: McpCli, cwd: string): Promise<McpServerState[]> {
  const args = cli === "claude" ? ["mcp", "list"] : ["mcp", "list", "--json"];
  const result = await exec(cli, args, { cwd, timeout: 120_000 });
  if (!result.ok) {
    throw new Error(`\`${cli} ${args.join(" ")}\` failed: ${result.stderr || result.stdout}`);
  }
  return cli === "claude" ? parseClaudeMcpList(result.stdout) : parseCodexMcpList(result.stdout);
}

/**
 * Run `<cli> mcp login <name>`, which opens the OAuth page in the browser and exits once the
 * user has logged in. Claude refuses to log in without a terminal, so it runs under `script`
 * to give it a pseudo-terminal.
 */
function loginMcpServer(cli: McpCli, name: string, cwd: string, signal: AbortSignal) {
  const command = [cli, "mcp", "login", name];
  const args =
    process.platform === "darwin"
      ? ["-q", "/dev/null", ...command]
      : [
          "-q",
          "-c",
          command.map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(" "),
          "/dev/null",
        ];
  return new Promise<void>((resolve) => {
    const child = spawn("script", args, { cwd, stdio: "ignore", signal });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

export interface McpLoginDeps {
  list: (cli: McpCli, cwd: string) => Promise<McpServerState[]>;
  login: (cli: McpCli, name: string, cwd: string, signal: AbortSignal) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: McpLoginDeps = {
  list: listMcpServers,
  login: loginMcpServer,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export interface EnsureMcpLoginsOpts {
  cli: McpCli;
  servers: string[];
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called once per server the first time the run has to wait for its login. */
  onWaiting?: (server: string) => Promise<void>;
}

/**
 * Block until every required MCP server is logged in. Servers that need a login get
 * `<cli> mcp login`, and the list is re-checked until they report connected.
 * Throws if a required server isn't configured for this CLI or the wait runs out.
 */
export async function ensureMcpLogins(
  opts: EnsureMcpLoginsOpts,
  deps: McpLoginDeps = defaultDeps,
): Promise<void> {
  if (opts.servers.length === 0) return;
  const deadline = deps.now() + (opts.timeoutMs ?? DEFAULT_MCP_LOGIN_TIMEOUT_MS);
  const announced = new Set<string>();

  for (let round = 0; ; round++) {
    const states = await deps.list(opts.cli, opts.cwd);
    const missing = opts.servers.filter(
      (required) => !states.some((s) => mcpServerMatches(required, s.name)),
    );
    if (missing.length > 0) {
      throw new Error(`MCP server not configured for ${opts.cli}: ${missing.join(", ")}`);
    }
    const pending = states.filter(
      (s) =>
        s.status === "needs-auth" &&
        opts.servers.some((required) => mcpServerMatches(required, s.name)),
    );
    if (pending.length === 0) return;

    if (round > 0) await deps.sleep(RETRY_DELAY_MS);
    for (const server of pending) {
      const remainingMs = deadline - deps.now();
      if (remainingMs <= 0) {
        throw new Error(`Gave up waiting for the ${server.name} MCP login`);
      }
      if (!announced.has(server.name)) {
        announced.add(server.name);
        await opts.onWaiting?.(server.name);
      }
      const signals = [AbortSignal.timeout(remainingMs), ...(opts.signal ? [opts.signal] : [])];
      await deps.login(opts.cli, server.name, opts.cwd, AbortSignal.any(signals));
      opts.signal?.throwIfAborted();
    }
  }
}
