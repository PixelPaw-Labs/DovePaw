# Phase 6 — Publish to Plugin Repo

Ask 2 questions in a single `AskUserQuestion` call:

1. "Move agent from Kiln to plugin repo and push?" — options:
   - Yes, move and push now (Recommended)
   - Move locally only, push later
   - Keep in Kiln for now

2. "Install and restart DovePaw servers?" — options:
   - Yes — run `npm run install` + restart servers (Recommended)
   - No, I'll handle it later

**If publishing:**

1. Determine plugin repo path from user's Round 1 answer (or ask again if "None" was chosen)
2. Create `agents/<name>/` in the plugin repo dir
3. Copy `~/.dovepaw/tmp/<name>/main.ts` → `agents/<name>/main.ts`
4. Copy `~/.dovepaw/tmp/<name>/agent.json` → `agents/<name>/agent.json`, add `"pluginPath": "<abs-plugin-repo-path>"`
5. Read `dovepaw-plugin.json` in the plugin repo, add `"<name>"` to the `agents` array, write back
6. `git add agents/<name>/ dovepaw-plugin.json && git commit -m "feat: add <name> agent" && git push` (in plugin repo dir)
7. Remove `~/.dovepaw/tmp/<name>/` so agent exits the Kiln group

**If installing:** run `npm run install` in the DovePaw project root (confirm with user before running).

Always remind: restart `npm run chatbot:servers` to register the new A2A server.
