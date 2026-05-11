---
name: sub-agent-builder
description: "Scaffold a new DovePaw background agent end-to-end. Creates agent files in ~/.dovepaw/tmp/ so the agent appears immediately in the Kiln sidebar group, ready to test. Optionally publishes to a plugin repo. Use when asked to 'create a new agent', 'scaffold an agent', 'add a new background agent', 'build a new daemon', or when the user wants to automate a recurring or on-demand task with a DovePaw agent."
argument-hint: "Optional: agent name and/or purpose description"
allowed-tools: Read, Write, Edit, Bash(mkdir *), Bash(python3 *), Bash(ls *), Bash(cat *), Glob, Grep, AskUserQuestion
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/sub-agent-builder/hooks/quality-gate.js"'
---

## Inputs

`$ARGUMENTS` — optional agent name and/or purpose. Parse any name/purpose hints before asking questions.

## System Requirements

- DovePaw must be installed (`~/.dovepaw/` must exist)
- Read `~/.dovepaw/settings.json` to discover configured repositories before Round 3 questions

---

## Execution

### Phase 1 — Requirements Gathering

Read `${CLAUDE_SKILL_DIR}/steps/phase1-requirements.md` and follow all instructions.

---

### Phase 2 — Design file structure, then generate source files

Read `${CLAUDE_SKILL_DIR}/steps/phase2-source-files.md` and follow all instructions.

---

### Phase 3 — Create agent.json

Read `${CLAUDE_SKILL_DIR}/steps/phase3-agent-json.md` and follow all instructions.

---

### Phase 4 — Associated Skill

Read `${CLAUDE_SKILL_DIR}/steps/phase4-skill.md` and follow all instructions.

---

### Phase 5 — Integration Check

Read `${CLAUDE_SKILL_DIR}/steps/phase5-integration.md` and follow all instructions.

---

### Phase 6 — Publish to Plugin Repo

Read `${CLAUDE_SKILL_DIR}/steps/phase6-publish.md` and follow all instructions.
