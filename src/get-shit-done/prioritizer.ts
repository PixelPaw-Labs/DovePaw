/**
 * Prioritizer: parsing, filtering, and ticket prioritization via Claude.
 */

import type { ClaudeRunner, LogFn } from "./claude-runner.js";
import { parseJson } from "../lib/json.js";
import { AUTONOMY_PREFIX } from "./prompts.js";
import { resolveRepoName } from "../lib/repos.js";
import { validateDependsOn } from "./dag.js";

export interface RepoAssignment {
  repoPath: string; // repo basename from prioritizer, resolved to abs path by pipeline
  branch: string; // slugified branch name (e.g. "ec-123-fix-payment-bug")
}

export type TicketComplexity = "trivial" | "moderate" | "complex";

export interface TicketAssignment {
  key: string;
  repos: RepoAssignment[]; // one or more repos this ticket touches
  complexity: TicketComplexity;
}

export function ticketKeys(group: TicketAssignment[]): string[] {
  return group.map((t) => t.key);
}

export interface Verification {
  required: boolean;
  reason: string;
}

export interface GroupedLayer {
  group: TicketAssignment[];
  relation: string | null;
  verification: Verification;
  /** Primary ticket key of the parent group this depends on, or null for root (branches from main). */
  dependsOn: string | null;
}

// Re-export from dag for consumers that previously imported from prioritizer
export { primaryKey } from "./dag.js";

export interface SkippedTicket {
  key: string;
  reason: string;
  /** True when skipped due to an in-flight dependency (In Progress / In Review).
   *  Orchestrator uses this to avoid wrongly promoting the ticket to "In Review". */
  inFlightDependency: boolean;
}

export interface PrioritizeResult {
  layers: GroupedLayer[];
  skipped: SkippedTicket[];
  excluded: Array<{ key: string; reason: string }>;
}

export interface SprintTicket {
  key: string;
  status: string;
}

// ─── Raw JSON shape matching the skill output-format.md ─────────────────────

interface RawRepo {
  repo: string;
  branch: string;
}
interface RawTicket {
  key: string;
  complexity: string;
  repos: RawRepo[];
}
interface RawVerification {
  required: boolean;
  reason: string;
}
interface RawLayer {
  group: RawTicket[];
  relation: string | null;
  verification: RawVerification;
  depends_on: string | null;
}
interface RawKeyReason {
  key: string;
  reason: string;
  /** True when the ticket is waiting on an in-flight dependency (In Progress / In Review).
   *  False / absent = permanently skipped (redundant, out-of-scope, etc.) */
  in_flight_dependency?: boolean;
}
export interface RawPrioritizeOutput {
  layers: RawLayer[];
  skipped?: RawKeyReason[];
  excluded?: RawKeyReason[];
}

function isRawOutput(v: unknown): v is RawPrioritizeOutput {
  return typeof v === "object" && v !== null && "layers" in v && Array.isArray(v.layers);
}

function toComplexity(raw: string): TicketComplexity {
  if (raw === "trivial" || raw === "moderate" || raw === "complex") return raw;
  return "moderate";
}

function toGroupedLayer(raw: RawLayer): GroupedLayer {
  return {
    group: raw.group.map((t) => ({
      key: t.key,
      repos: (t.repos ?? []).map((r) => ({ repoPath: r.repo, branch: r.branch })),
      complexity: toComplexity(t.complexity),
    })),
    relation: raw.relation ?? null,
    verification: {
      required: raw.verification?.required ?? true,
      reason: raw.verification?.reason ?? "unknown",
    },
    dependsOn: raw.depends_on ?? null,
  };
}

/**
 * Parse raw prioritizer JSON output into a typed PrioritizeResult.
 * Expects the format defined in output-format.md. Returns null if parsing fails.
 */
export function parsePrioritizerOutput(raw: string): PrioritizeResult | null {
  const parsed = parseJson(raw, isRawOutput);
  if (!parsed) return null;

  const layers = parsed.layers.map(toGroupedLayer);
  const skipped = (parsed.skipped ?? []).map((s) => ({
    key: s.key,
    reason: s.reason,
    inFlightDependency: s.in_flight_dependency === true,
  }));
  const excluded = parsed.excluded ?? [];

  return { layers, skipped, excluded };
}

// Re-export from dag for consumers that previously imported from prioritizer
export { validateDependsOn } from "./dag.js";

/**
 * Build a single-layer fallback when there is only one ticket (prioritization skipped).
 */
export function fallbackResult(tickets: string[]): PrioritizeResult {
  return {
    layers: [
      {
        group: tickets.map((key) => ({
          key,
          repos: [],
          complexity: "moderate" as TicketComplexity,
        })),
        relation: null,
        verification: { required: true, reason: "fallback — assuming verification needed" },
        dependsOn: null,
      },
    ],
    skipped: [] as SkippedTicket[],
    excluded: [],
  };
}

/**
 * Classify sprint tickets into pending (To Do/Backlog) and context (everything else).
 */
export function classifyTickets(tickets: SprintTicket[]): {
  pending: SprintTicket[];
  context: SprintTicket[];
} {
  const pendingStatuses = new Set(["to do", "backlog"]);
  const pending = tickets.filter((t) => pendingStatuses.has(t.status.toLowerCase()));
  const context = tickets.filter((t) => !pendingStatuses.has(t.status.toLowerCase()));
  return { pending, context };
}

/**
 * Filter a prioritizer layer's group to only unprocessed pending tickets,
 * excluding skipped and excluded tickets.
 */
export function filterGroup(
  group: TicketAssignment[],
  unprocessed: Set<string>,
  skippedKeys: Set<string>,
  excludedKeys: Set<string>,
): TicketAssignment[] {
  return group.filter(
    (t) => unprocessed.has(t.key) && !skippedKeys.has(t.key) && !excludedKeys.has(t.key),
  );
}

// ─── Prioritizer deps ───────────────────────────────────────────────────────

export interface PrioritizerDeps {
  runner: ClaudeRunner;
  scriptDir: string;
  log: LogFn;
}

// ─── Prioritizer class ──────────────────────────────────────────────────────

export class Prioritizer {
  private readonly runner: ClaudeRunner;
  private readonly scriptDir: string;
  private readonly log: LogFn;
  constructor(deps: PrioritizerDeps) {
    this.runner = deps.runner;
    this.scriptDir = deps.scriptDir;
    this.log = deps.log;
  }

  async prioritize(
    allTickets: string[],
    repos: string[],
    previousGuidance?: string,
  ): Promise<{ resolved: PrioritizeResult; rawJson: string }> {
    if (allTickets.length <= 1) {
      const result = fallbackResult(allTickets);
      return { resolved: result, rawJson: JSON.stringify(result) };
    }

    this.log(
      `PRIORITIZING: ${allTickets.length} ticket(s)${previousGuidance ? " (guided by previous run)" : ""}`,
    );

    const ticketList = allTickets.join(",");
    const repoList = repos.join("\n");

    const guidanceNote = previousGuidance
      ? `\nIMPORTANT — PREVIOUS RUN GUIDANCE:\n${previousGuidance}`
      : "";

    const { code, stdout } = await this.runner.run(
      [
        `[GSD: prioritize ${allTickets.length} tickets] ${AUTONOMY_PREFIX}`,
        guidanceNote,
        "",
        `Invoke Skill("/jira-ticket-prioritizer 'Prioritize tickets ${ticketList} and assign each to one of these repos:`,
        repoList,
        `Use the repo basename in output (not the full path).'").`,
        "",
        "Return json ONLY without code fence",
      ].join("\n"),
      {
        taskName: `get-shit-done: prioritizing ${allTickets.length} tickets`,
        cwd: this.scriptDir,
        timeoutMs: 5 * 60 * 60 * 1000,
        model: "opus",
      },
    );

    if (code === 0) {
      const result = parsePrioritizerOutput(stdout);
      if (result) {
        for (const w of validateDependsOn(result.layers)) this.log(`WARN: ${w}`);
        // Save raw LLM output JSON (original field names: repo, depends_on)
        // before parsing renames them (repoPath, dependsOn) and resolves paths.
        const rawJson = extractJson(stdout);
        resolveAndValidateRepos(result, repos);
        logPrioritizeResult(result, this.log);
        return { resolved: result, rawJson };
      }
      throw new Error("Prioritizer output parse failed — terminating");
    } else {
      throw new Error(`Prioritizer exited with code ${code} — terminating`);
    }
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Extract the first JSON object from LLM stdout (may contain preamble text). */
function extractJson(stdout: string): string {
  const start = stdout.indexOf("{");
  if (start === -1) return stdout;
  // Find matching closing brace
  let depth = 0;
  for (let i = start; i < stdout.length; i++) {
    if (stdout[i] === "{") depth++;
    else if (stdout[i] === "}") depth--;
    if (depth === 0) return stdout.slice(start, i + 1);
  }
  return stdout.slice(start);
}

function resolveAndValidateRepos(result: PrioritizeResult, baseRepos: string[]): void {
  for (const layer of result.layers) {
    for (const ticket of layer.group) {
      if (ticket.repos.length === 0) {
        throw new Error(`Prioritizer did not assign any repos for ${ticket.key}`);
      }
      for (const ra of ticket.repos) {
        if (!ra.repoPath) throw new Error(`Empty repo name for ${ticket.key}`);
        if (!ra.branch) throw new Error(`Empty branch name for ${ticket.key} in ${ra.repoPath}`);
        const resolved = resolveRepoName(ra.repoPath, baseRepos);
        if (!resolved) throw new Error(`Cannot resolve repo "${ra.repoPath}" for ${ticket.key}`);
        ra.repoPath = resolved;
      }
    }
  }
}

function logPrioritizeResult(result: PrioritizeResult, log: LogFn): void {
  const summary = result.layers
    .map((l, i) => {
      const dep = l.dependsOn ? `→${l.dependsOn}` : "";
      return `L${i}:[${ticketKeys(l.group).join(",")}]${dep}`;
    })
    .join(" ");
  log(`PRIORITIZED: ${result.layers.length} layer(s) — ${summary}`);
  if (result.skipped.length > 0) log(`SKIPPED: ${result.skipped.map((s) => s.key).join(", ")}`);
  if (result.excluded.length > 0) log(`EXCLUDED: ${result.excluded.map((e) => e.key).join(", ")}`);
}
