# Plan: `jira-ticket-runner` Agent

## Context

`get-shit-done` always forges all sprint tickets using the `forge` skill. The new `jira-ticket-runner` agent handles **a single ticket** and routes it to the most appropriate skill based on the ticket's content, type, and labels. This enables a more targeted, on-demand workflow — run the right tool for the job rather than always implementing code.

The skill routing list is **built dynamically at runtime** by scanning the `skills/` directory and parsing each skill's `description` from its SKILL.md YAML frontmatter. This means new skills become available to the router automatically.

**Intended outcome:** User (or another agent) passes a single JIRA ticket key; the agent reads the ticket, reasons against the live skill catalogue, picks the best skill(s), and executes them.

---

## Files to Create

### 1. `agents/jira-ticket-runner/main.ts`

Follow the `zendesk-triager/main.ts` pattern with one addition: a `loadAvailableSkills()` helper that dynamically enumerates skills.

**Config:**

```typescript
const REPOS = parseRepos("REPO_LIST");
const TICKET_KEY = process.argv[2] || "";
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../skills");
```

**Dynamic skill loader** — pure Node, no extra deps. Scans `skills/*/SKILL.md` in parallel and parses `name` + `description` from YAML frontmatter:

```typescript
async function loadAvailableSkills(): Promise<{ name: string; description: string }[]> {
  const dirs = await readdir(SKILLS_DIR, { withFileTypes: true });
  const results = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (dir) => {
        const skillMdPath = join(SKILLS_DIR, dir.name, "SKILL.md");
        try {
          const content = await readFile(skillMdPath, "utf8");
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (!match) return null;
          const fm = match[1];
          const nameMatch = fm.match(/^name:\s*(.+)$/m);
          const descMatch = fm.match(/^description:\s*["']?(.*?)["']?\s*$/m);
          if (nameMatch && descMatch)
            return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
        } catch {
          /* skip */
        }
        return null;
      }),
  );
  return results.filter((s): s is { name: string; description: string } => s !== null);
}
```

**Prompt builder:**

```typescript
function buildPrompt(skills: { name: string; description: string }[]): string {
  return [
    `[JIRA Ticket Runner] ${AUTONOMY_PREFIX}`,
    "",
    `Ticket: ${TICKET_KEY}`,
    REPOS.length > 0 ? `Repos: ${REPOS.join(", ")}` : "",
    "",
    "## Task",
    "",
    `1. Read the ticket: Skill("/jira-ticket-viewer ${TICKET_KEY}")`,
    "",
    "2. Based on ticket type, labels, summary, and description, select the most appropriate",
    "   skill(s) from the catalogue below and execute them in the correct order.",
    "   - A ticket may require chaining skills (e.g. implement → verify → PR).",
    "   - If no skill clearly matches the ticket's intent, report why and stop.",
    "     Do NOT guess — this agent exists precisely to pick the right tool.",
    "",
    "## Available Skills",
    "",
    ...skills.map((s) => `- **${s.name}**: ${s.description}`),
    "",
    "3. Report which skill(s) you chose, the reasoning, and a brief outcome summary.",
  ]
    .filter(Boolean)
    .join("\n");
}
```

**Main:**

```typescript
async function main() {
  if (!TICKET_KEY) {
    log(
      "ERROR: No ticket key provided. Pass a JIRA ticket key as the first argument (e.g., EC-123).",
    );
    process.exit(1);
  }
  log("=== JIRA Ticket Runner started ===");
  log(`Ticket: ${TICKET_KEY}`);
  const skills = await loadAvailableSkills();
  log(`Available skills (${skills.length}): ${skills.map((s) => s.name).join(", ")}`);
  const prompt = buildPrompt(skills);
  const { code, stdout } = await spawnClaudeWithSignals(
    ["--permission-mode", "acceptEdits", "-p", prompt],
    { cwd: WORK_DIR, taskName: "jira-ticket-runner", timeoutMs: 24 * 60 * 60 * 1000 },
  );
  log(`Claude CLI exited with code: ${code}`);
  log(stdout);
  log("=== JIRA Ticket Runner finished ===");
  cleanupOldLogs(LOG_DIR, ["jira-ticket-runner-"], 30);
}
```

---

## Files to Modify

### 2. `lib/agents.ts`

Add `Ticket` to the lucide-react import and append a new entry to `AGENTS`:

```typescript
import {
  Brain,
  Zap,
  Radar,
  FlaskConical,
  BellRing,
  LifeBuoy,
  GitMerge,
  Ticket,
} from "lucide-react";
```

```typescript
defineAgent({
  name: "jira-ticket-runner",
  alias: "jtr",
  displayName: "JIRA Ticket Runner",
  description:
    "Run a single JIRA ticket through the right skill: reads the ticket content and " +
    "automatically routes it to the most appropriate skill (forge, pir, zendesk-triager, " +
    "dependabot-merger, qa-web-test, domain-discover, datadog-analyser, etc.). " +
    "Use when asked to 'run ticket EC-123', 'process a JIRA ticket', 'handle ticket', " +
    "or 'work on <ticket-key>'. Pass the ticket key as the instruction, e.g. 'EC-123'. " +
    "Requires REPO_LIST env var.",
  requiredEnvVars: ["REPO_LIST"],
  reposEnvVar: "REPO_LIST",
  icon: Ticket,
  scheduleDisplay: "on demand",
}),
```

No `schedule` property = on-demand only (same as `zendesk-triager`).

> `start-all.ts` iterates `AGENTS` automatically — no separate A2A file needed.

### 3. `chatbot/a2a/lib/__tests__/base-server.test.ts`

Add `jira_ticket_runner` to `SAMPLE_PORTS`. The manifest schema validates all agent manifest keys are present, so new agents require a corresponding test fixture entry:

```typescript
const SAMPLE_PORTS = {
  memory_dream: 51001,
  get_shit_done: 51002,
  release_log_sentinel: 51003,
  memory_distiller: 51004,
  oncall_analyzer: 51005,
  zendesk_triager: 51006,
  jira_ticket_runner: 51007, // ← add
  dependabot_merger: 51008,
};
```

---

## Critical Files

| File                                            | Action                                                |
| ----------------------------------------------- | ----------------------------------------------------- |
| `agents/jira-ticket-runner/main.ts`             | **Create**                                            |
| `lib/agents.ts`                                 | **Modify** — add `Ticket` icon import + agent entry   |
| `chatbot/a2a/lib/__tests__/base-server.test.ts` | **Modify** — add `jira_ticket_runner` port to fixture |

### Referenced Utilities (reuse, do not recreate)

| Utility                                           | File                   |
| ------------------------------------------------- | ---------------------- |
| `spawnClaudeWithSignals`, `AUTONOMY_PREFIX`       | `agents/lib/claude.ts` |
| `createLogger`, `makeTimestamp`, `cleanupOldLogs` | `agents/lib/logger.ts` |
| `parseRepos`                                      | `agents/lib/repos.ts`  |
| `agentPersistentLogDir`                           | `lib/paths.ts`         |

---

## Skill Routing Design

The agent uses **Claude's reasoning** against a live skill catalogue — no hardcoded routing table:

1. `jira-ticket-viewer` fetches the full ticket (type, labels, summary, description, linked issues)
2. Claude matches ticket intent against the dynamically built skill list
3. Claude executes the chosen skill(s) in sequence
4. If no skill clearly fits → report and stop. Do not guess.

This is the correct pattern for DovePaw: Claude is the reasoning engine; the agent provides structured context and constraints.

---

## Verification

1. `npm run build` — confirm `dist/jira-ticket-runner.mjs` is emitted, no TS errors
2. `npm run lint` — no oxlint warnings
3. `npm run chatbot:test` — all tests pass (294 tests)
4. Start `npm run chatbot:dev:all` — verify `~/.dovepaw/.ports.json` includes `jira_ticket_runner` key
5. Invoke `ask_jira_ticket_runner` with a real ticket key — verify skill-selection reasoning appears in the response
