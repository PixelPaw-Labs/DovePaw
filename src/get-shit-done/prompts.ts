import { join } from "node:path";
import type { TicketComplexity } from "./prioritizer.js";
import { AUTONOMY_PREFIX } from "../lib/claude.js";

export { AUTONOMY_PREFIX };

// ─── Types ───────────────────────────────────────────────────────────────────

export type ForgeStatus = "success" | "partial" | "failed";

export interface WorktreeInfo {
  repoPath: string;
  worktreePath: string;
}

export interface ForgeResult {
  ticketKey: string;
  status: ForgeStatus;
  worktrees: WorktreeInfo[];
  affectedUrls: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

// ─── Worktree helpers ────────────────────────────────────────────────────────

export function worktreePath(repoAbsPath: string, branch: string): string {
  return join(repoAbsPath, ".claude", "worktrees", branch);
}

// ─── Forge prompt ────────────────────────────────────────────────────────────

const COMPLEXITY_HINTS: Record<TicketComplexity, string> = {
  trivial:
    "complexity=trivial: small, focused change (e.g. config, copy, single-file fix). Read only the ticket and go straight to implementation. Do not scan the codebase for domain knowledge, fetch linked resources, inspect pages, or optimize the prompt.",
  moderate:
    "complexity=moderate: contained change within a single area. Read the ticket, scan relevant parts of the codebase, and fetch linked resources. Only inspect browser pages if the ticket explicitly mentions UI, frontend, or visual changes.",
  complex:
    "complexity=complex: spans multiple areas, involves migrations/feature flags, or has ambiguous requirements. Gather full context — codebase scan, linked resources, page inspection, and prompt clarification — before implementing.",
};

export function buildForgePrompt(
  ticketKey: string,
  ticketUrl: string,
  devServerInfo: string,
  complexity: TicketComplexity,
): string {
  const devCtx = devServerInfo ? `Dev servers are already running: ${devServerInfo}` : "";
  const complexityCtx = COMPLEXITY_HINTS[complexity];
  const extra = [devCtx, complexityCtx].filter(Boolean).join("\n");

  return [
    `[GSD: forge ${ticketKey}] ${AUTONOMY_PREFIX}`,
    "",
    `Invoke Skill("/forge ${ticketUrl}${extra ? ` '${extra}'` : ""}")`,
    "",
    "Report completion as plain text.",
  ].join("\n");
}

// ─── Merge prompt ────────────────────────────────────────────────────────────

export function buildMergePrompt(
  primaryTicket: string,
  worktreePaths: string[],
  baseBranch?: string,
): string {
  const worktrees = worktreePaths.map((wt) => `  ${wt}`).join("\n");
  const base = baseBranch ?? "main";
  const stackedNote = baseBranch
    ? [
        "",
        `IMPORTANT: This is a stacked merge. The base branch "${baseBranch}" contains changes from a prior layer`,
        "that the worktrees were NOT aware of (they were forked from main). Expect conflicts or overlapping",
        "edits — resolve them so that both the prior layer's changes and this layer's changes work together.",
      ].join("\n")
    : "";

  return [
    `[GSD: merge ${primaryTicket}] ${AUTONOMY_PREFIX}`,
    "",
    "Worktrees to merge:",
    worktrees,
    stackedNote,
    "",
    "Steps:",
    `1. Create a merge branch from "${base}" (NOT from a worktree) named "${primaryTicket}-merge-{slug}"`,
    `   e.g. "${primaryTicket}-merge-add-team-tabs" (slug from primary ticket title, lowercase, hyphens)`,
    "2. Run: entire enable -f --local --agent claude-code --skip-push-sessions",
    "   Then run: entire configure --skip-push-sessions --agent claude-code --local",
    "3. Merge ALL worktree changes into the merge branch",
    "   (even if only one worktree — always merge to the merge branch):",
    "   - git merge or cherry-pick from each worktree branch",
    "   - Resolve any conflicts",
    "4. Verify the merged code compiles and has no obvious issues",
    "5. Clean up all worktree branches used in this merge:",
    "   - For each worktree branch: git worktree remove <path> --force",
    "   - Then delete the local branch: git branch -D <branch>",
    "   - Do NOT ask for confirmation — always force clean up",
    "",
    "Return ONLY the merge branch name as plain text.",
  ].join("\n");
}

// ─── Verify prompt ───────────────────────────────────────────────────────────

export function buildVerifyPrompt(
  primaryTicket: string,
  devUrl: string,
  mergeBranch: string,
  verification: { required: boolean; reason: string },
  affectedUrls: string[] = [],
): string {
  const devCtx = devUrl
    ? `Dev servers are running at ${devUrl} on merge branch "${mergeBranch}" (started externally).`
    : `No dev servers running (UI verification not required).`;

  const verifyTarget = affectedUrls.length > 0 ? affectedUrls.join(" ") : devUrl;

  return [
    `[GSD: verify ${primaryTicket}] ${AUTONOMY_PREFIX}`,
    "",
    devCtx,
    `Ensure you are on the merge branch "${mergeBranch}" before verifying.`,
    "",
    `Verification context:`,
    `- Web UI verification required: ${verification.required}`,
    `- Reason: ${verification.reason}`,
    "",
    `Run: Skill("/verification${verifyTarget ? ` ${verifyTarget}` : ""}")`,
    "",
    "Report the result as plain text.",
  ].join("\n");
}

// ─── Commit prompt ──────────────────────────────────────────────────────────

export function buildCommitPrompt(ticketKey: string): string {
  return [
    `[GSD: commit ${ticketKey}] ${AUTONOMY_PREFIX}`,
    "",
    `Commit only ticket-related code changes in this worktree for ${ticketKey}.`,
    "",
    "Before committing, discard any test artifacts that should not be committed:",
    "  git checkout -- '**/*.png' '**/*.jpg' '**/*.jpeg' '**/*.webp' '**/*.gif'",
    "  git checkout -- '**/screenshots/**' '**/test-results/**' '**/playwright-report/**'",
    "Only stage and commit source code, tests, configs, and documentation.",
    "",
    `Skill("/git-commit")`,
  ].join("\n");
}

// ─── PR prompt ───────────────────────────────────────────────────────────────

export interface PrDependency {
  baseBranch: string;
  prUrl: string;
}

export function buildPrPrompt(
  ticketKeys: string[],
  mergeBranch: string,
  dependency?: PrDependency,
  _screenshots?: string[],
): string {
  const tickets = ticketKeys.join(", ");
  const base = dependency?.baseBranch ?? "main";
  const depNote = dependency
    ? `\n\nThis is a stacked PR. Set the PR base branch to "${dependency.baseBranch}" (not main). Add to the PR description: "Depends on ${dependency.prUrl} — merge that first."`
    : "";

  return [
    `[GSD: create PR for ${tickets}] ${AUTONOMY_PREFIX}`,
    "",
    `You are on merge branch "${mergeBranch}" with all changes already committed and merged.`,
    `The base branch is "${base}".${depNote}`,
    `Skill("/create-pr 'create a Draft PR and keep description concise'")`,
  ].join("\n");
}
