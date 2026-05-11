# Phase 5 — Integration Check

**Non-TypeScript agents** — quick sanity pass only:

- No unsubstituted `{{PLACEHOLDER}}` values remaining
- `agent.json` has all required fields and no `pluginPath`
- Every `envVars` entry has an `id` UUID and `value: ""`

**TypeScript agents** — read `references/integration-checklist.md` now for lint/fmt commands and path reference.

Read each created file back and verify against this checklist. Fix any issue found, then re-check until every item passes:

- **main.ts** — all `{{PLACEHOLDER}}` values substituted; spawning pattern matches the chosen Option A/B/C; `INSTRUCTION` is passed through to Claude; no dead branches; `publishStatusToUI` called at meaningful steps (awaited); subprocess env is correct (no `CLAUDECODE`, clean PATH); every `runner.run()` call supplies BOTH `claudeOpts` AND `codexOpts`
- **agent.json** (`~/.dovepaw/tmp/<name>/agent.json`) — all required fields present; `pluginPath` is NOT set; every entry in `envVars` has an `id` UUID (missing `id` causes Zod to silently drop the agent from the Kiln group)
- **SKILL.md** (if created) — frontmatter is valid for Claude Code; argument pattern is documented; output contract is defined
- **agent-local** (if `{CLAUDE_PROJECT_DIR}/agent-local/<name>/` now exists) — `agent.json` has no `pluginPath`; every `envVars` entry has an `id` UUID; all `envVars[*].value` are `""` (no secrets in source); `main.ts` is present and non-empty

End with a confidence score JSON on its own line:

```json
{"confidence": <0-100>, "issues": ["<any remaining issue>"]}
```

The Stop hook requires `confidence >= 90` to proceed. Emit this only after all fixes are complete — it must reflect the post-fix state.

Tell the user: "Your agent is ready. **Refresh the page** to see it appear under the **Kiln** group in the sidebar (Sparkles icon)."

Ask 1 question via `AskUserQuestion`:

- **Restart A2A servers?** — "Restart DovePaw A2A servers to register the new agent?" — options:
  - Yes — restart `npm run chatbot:servers` now (Recommended)
  - No, I'll handle it later

If the user selects **Yes**, remind them to run `npm run chatbot:servers` in the DovePaw project root.
