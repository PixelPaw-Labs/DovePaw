# Phase 3 — Create agent.json

Read `references/agent-registration.md` now — it has the agent.json template and the full icon/color catalog.

Ask 1 question via `AskUserQuestion`:

- **Icon** — "Which icon suits this agent best?" — suggest 4 options inferred from purpose: analytics/reasoning → `Brain`, automation → `Zap`, alerts/incidents → `BellRing`, docs → `FileText`, code → `GitMerge`, search → `Search`, time → `Clock`, data → `Database`

Create `~/.dovepaw/tmp/<name>/agent.json` using the template in `references/agent-registration.md`.

Fill in all fields:

- `name` — kebab-case
- `alias` — 2–3 char shorthand (make it unique)
- `displayName` — human-readable title
- `description` — MCP tool description Dove uses to route requests
- `personality` — 1–3 sentence character paragraph; write in second person ("You are…"); replaces the generic "You are one of Dove's mice…" opening in the sub-agent system prompt
- `schedulingEnabled` — `true` only if interval/calendar
- `schedule` — include only when schedulingEnabled; use `"interval"` or `"calendar"` type
- `repos` — UUIDs from settings.json matching selected repo paths
- `envVars` — `[{ "id": "<uuid>", "key": "VAR", "value": "", "isSecret": true }]` for each required var — `id` is required by the schema (use `crypto.randomUUID()` pattern: generate a fresh UUID for each entry)
- `iconName` / `iconBg` / `iconColor` — from icon choice (see color palettes in `references/agent-registration.md`)
- `doveCard` — write a concise title + description + starter prompt
- `suggestions` — exactly 3 chips in this fixed order:
  1. **How does it work?** — title `"How does it work?"`, prompt `"How does {{DISPLAY_NAME}} work?"`
  2. **Last run logs** — title `"Last run logs"`, prompt `"Show {{DISPLAY_NAME}} logs"`
  3. **Run the agent** — title `"Run the agent"`, description and prompt depend on whether the agent needs user-provided input at runtime:
     - **No input needed** (self-contained, e.g. a scheduled digest): prompt = `"Run {{DISPLAY_NAME}} now"`
     - **Input needed** (e.g. ticket number, URL, repo name): prompt = `"Run {{DISPLAY_NAME}} — I'll need a few details from you: {{what to ask}}"` — phrase it as an invitation so the user knows to provide the missing info
  4. **What does it need?** — title `"What does it need?"`, prompt = `"What does {{DISPLAY_NAME}} need to run? List its dependencies, required env vars, and any setup steps."` — always fixed, no variation needed

Do NOT set `pluginPath` — that is added at publish time.

**Phase 3 gate — verify before proceeding:**

- [ ] All required fields present: `name`, `alias`, `displayName`, `description`, `personality`, `schedulingEnabled`, `repos`, `envVars`, `iconName`, `iconBg`, `iconColor`, `doveCard`, `suggestions`
- [ ] `pluginPath` is NOT set
- [ ] Every `envVars` entry has an `id` UUID (missing `id` silently drops the agent from Kiln)
- [ ] Icon values match an actual entry in `references/agent-registration.md`

Fix any failures before continuing.

After writing `agent.json`, bootstrap the agent's `node_modules` so `@dovepaw/agent-sdk` resolves at runtime:

```bash
python3 -c "
import os
base = os.path.expanduser('~/.dovepaw/tmp/<name>')
pkg_dir = os.path.join(base, 'node_modules', '@dovepaw')
os.makedirs(pkg_dir, exist_ok=True)
sdk_target = os.path.expanduser('~/.dovepaw/sdk')
link = os.path.join(pkg_dir, 'agent-sdk')
if not os.path.exists(link):
    os.symlink(sdk_target, link)
"
```
