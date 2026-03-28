/**
 * Memory Distiller - Extract common patterns from project-level MEMORY.md into global CLAUDE.md
 * Runs weekly (Sunday 01:00) via launchd
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaude } from "../lib/claude.js";
import { parseRepos, repoToSlug } from "../lib/repos.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const HOME = process.env.HOME!;
const PROJECTS_DIR = join(HOME, ".claude/projects");
const CLAUDE_MD = join(HOME, ".claude/CLAUDE.md");
const BASE_REPOS = parseRepos("REPO_LIST");

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ? join(process.env.AGENT_WORKSPACE, "agent_logs") : SCRIPT_DIR;
const LOG_DIR = join(WORK_DIR, "logs/.memory-distiller");
const LOG_FILE = join(LOG_DIR, `memory-distiller-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

// ─── Discover project memory files ──────────────────────────────────────────

interface MemoryFileInfo {
  repo: string;
  repoName: string;
  slug: string;
  memoryDir: string;
  memoryFile: string;
  memoryContent: string;
  topicFiles: Array<{ name: string; path: string; content: string }>;
}

function discoverMemoryFiles(): MemoryFileInfo[] {
  const files: MemoryFileInfo[] = [];
  for (const repo of BASE_REPOS) {
    const slug = repoToSlug(repo);
    const memoryDir = join(PROJECTS_DIR, slug, "memory");
    const memoryFile = join(memoryDir, "MEMORY.md");
    if (!existsSync(memoryFile)) continue;
    const memoryContent = readFileSync(memoryFile, "utf-8").trim();
    if (!memoryContent) continue;

    const topicFiles: MemoryFileInfo["topicFiles"] = [];
    if (existsSync(memoryDir)) {
      for (const f of readdirSync(memoryDir)) {
        if (f === "MEMORY.md" || !f.endsWith(".md")) continue;
        const content = readFileSync(join(memoryDir, f), "utf-8").trim();
        if (content) topicFiles.push({ name: f, path: join(memoryDir, f), content });
      }
    }

    files.push({
      repo,
      repoName: basename(repo),
      slug,
      memoryDir,
      memoryFile,
      memoryContent,
      topicFiles,
    });
  }
  return files;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log("=== Memory Distiller started ===");

  const memoryFiles = discoverMemoryFiles();

  if (memoryFiles.length < 2) {
    log(`Only ${memoryFiles.length} project memory file(s) found. Need at least 2. Exiting.`);
    return;
  }

  log(`Found ${memoryFiles.length} project memory file(s):`);
  for (const f of memoryFiles) {
    log(
      `  - ${f.repoName}: ${f.memoryFile} (${f.memoryContent.split("\n").length} lines, ${f.topicFiles.length} topic files)`,
    );
  }

  const suffix = randomBytes(3).toString("hex");
  const skillName = `memory-distiller-${suffix}`;
  const skillDir = join(HOME, ".claude/skills", skillName);
  const skillRefDir = join(skillDir, "references");
  mkdirSync(skillRefDir, { recursive: true });

  if (existsSync(CLAUDE_MD)) {
    copyFileSync(CLAUDE_MD, join(skillRefDir, "existing-claude-md.md"));
  } else {
    writeFileSync(join(skillRefDir, "existing-claude-md.md"), "[empty - file does not exist yet]");
  }

  // Copy MEMORY.md and topic files per project into references
  const memoryRefLinks: string[] = [];
  for (const f of memoryFiles) {
    const projectRefDir = join(skillRefDir, f.repoName);
    mkdirSync(projectRefDir, { recursive: true });

    copyFileSync(f.memoryFile, join(projectRefDir, "MEMORY.md"));
    for (const topic of f.topicFiles) {
      copyFileSync(topic.path, join(projectRefDir, topic.name));
    }

    const topicList =
      f.topicFiles.length > 0
        ? f.topicFiles
            .map((t) => `    - [${t.name}](references/${f.repoName}/${t.name})`)
            .join("\n")
        : "    - (no topic files)";
    memoryRefLinks.push(
      `  - **${f.repoName}**: [MEMORY.md](references/${f.repoName}/MEMORY.md) → \`${f.memoryDir}/\`\n${topicList}`,
    );
  }

  const filePathMapping = memoryFiles
    .map((f) => `  - ${f.repoName}: \`${f.memoryDir}/\``)
    .join("\n");

  const skillMd = `---
name: memory-distiller
description: Synthesize project-level memories into global CLAUDE.md
allowed-tools: Read, Edit, Write, Bash(mkdir *, rm *)
context: fork
---

# Memory Distiller

Analyze all project-level memory files (MEMORY.md indexes + topic files). Extract patterns
that appear across 2+ projects into the global CLAUDE.md, then remove those promoted entries
from project-level files.

## Task

You have ${memoryFiles.length} project memory directories and the global CLAUDE.md to work with.

### Step 1: Read all reference files
- Read [existing-claude-md.md](references/existing-claude-md.md)
${memoryRefLinks.join("\n")}

### Step 2: Identify cross-project patterns
Find entries (in MEMORY.md inline content OR topic files) that appear in **2 or more** projects.
Be CONSERVATIVE — only promote genuinely cross-project patterns, not framework-specific ones.

### Step 3: Update global CLAUDE.md
- File: ${CLAUDE_MD}
- Add under \`## Learned Preferences\` (create if needed)
- DEDUPLICATE and CORRECT CONTRADICTIONS (newer wins)

### Step 4: Remove promoted entries from project files
${filePathMapping}

When removing a promoted entry:
- If the entry is a **topic file**, delete the file and remove its index line from MEMORY.md
- If the entry is **inline content in MEMORY.md**, remove that section/bullet

### Step 5: Output summary

## Rules
- Be CONSERVATIVE — when in doubt, leave entries in project files
- An entry must appear in 2+ project files to qualify
- Don't promote framework-specific patterns (e.g., Rails-specific, React-specific)
- Keep CLAUDE.md organized and concise
- Preserve all existing CLAUDE.md content
`;

  writeFileSync(join(skillDir, "SKILL.md"), skillMd);

  log(`Invoking Claude CLI via skill /${skillName}...`);

  const { code: exitCode, stdout: claudeOutput } = await spawnClaude(
    ["--permission-mode", "acceptEdits", "-p", `/${skillName}`],
    { cwd: WORK_DIR, taskName: "memory-distiller", timeoutMs: 5 * 60 * 60 * 1000 },
  ).result;

  log(`Claude CLI exited with code: ${exitCode}`);
  if (claudeOutput) log(`--- Response ---\n${claudeOutput}`);

  try {
    rmSync(skillDir, { recursive: true, force: true });
    log(`Cleaned up skill directory: ${skillDir}`);
  } catch (err: unknown) {
    log(
      `WARN: Failed to clean up skill directory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  log("=== Memory Distiller finished ===");
  cleanupOldLogs(LOG_DIR, ["memory-distiller-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
