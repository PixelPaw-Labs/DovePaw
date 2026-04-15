# Agent Registration Reference

> **Before writing agent.json**, read `lib/agents-config-schemas.ts` in the DovePaw repo and verify the required fields against the live schema. The template below is a guide — the schema is the source of truth.

## agent.json Template

Write to `~/.dovepaw/tmp/<name>/agent.json`. Do NOT include `pluginPath` — it is added at publish time.

```json
{
  "version": 1,
  "name": "{{NAME}}",
  "alias": "{{ALIAS}}",
  "displayName": "{{DISPLAY_NAME}}",
  "description": "{{MCP_TOOL_DESCRIPTION}}",
  "personality": "{{PERSONALITY}}",
  "schedulingEnabled": false,
  "iconName": "{{LUCIDE_ICON_NAME}}",
  "iconBg": "{{ICON_BG}}",
  "iconColor": "{{ICON_COLOR}}",
  "doveCard": {
    "title": "{{DISPLAY_NAME}}",
    "description": "{{DOVE_CARD_DESCRIPTION}}",
    "prompt": "{{DOVE_CARD_PROMPT}}"
  },
  "suggestions": [
    {
      "title": "How does it work?",
      "description": "How does {{DISPLAY_NAME}} work?",
      "prompt": "How does {{DISPLAY_NAME}} work?"
    },
    {
      "title": "Last run logs",
      "description": "Show {{DISPLAY_NAME}} logs",
      "prompt": "Show {{DISPLAY_NAME}} logs"
    },
    {
      "title": "Run the agent",
      "description": "{{RUN_CHIP_DESCRIPTION}}",
      "prompt": "{{RUN_CHIP_PROMPT}}"
    },
    {
      "title": "What does it need?",
      "description": "What does {{DISPLAY_NAME}} need to run?",
      "prompt": "What does {{DISPLAY_NAME}} need to run? List its dependencies, required env vars, and any setup steps."
    }
  ],
  "repos": [],
  "envVars": [],
  "locked": false
}
```

### Schedule block (add only when `schedulingEnabled: true`)

Interval:

```json
"schedule": { "type": "interval", "seconds": 3600 }
```

Calendar (weekday is optional — 1=Mon … 7=Sun; omit for daily):

```json
"schedule": { "type": "calendar", "hour": 9, "minute": 0, "weekday": 1 }
```

### repos field

UUID strings from `~/.dovepaw/settings.json`. Match user's selected repo paths to their `id` fields.

### envVars field

```json
"envVars": [
  { "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "key": "JIRA_API_KEY", "value": "", "isSecret": true },
  { "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901", "key": "REPO_LIST", "value": "", "isSecret": false }
]
// ⚠️ id is REQUIRED — Zod's envVarSchema validates it as a UUID.
// Without it, safeParse returns false and the agent silently disappears from the Kiln group.
// Generate a fresh UUID (v4) for each entry.
```

---

## Icon Catalog (Lucide names)

Pick the icon that best matches the agent's purpose. All values below are valid `iconName` entries.

| Icon             | Purpose                               |
| ---------------- | ------------------------------------- |
| `Activity`       | live feed, events, health checks      |
| `AlertCircle`    | errors, issues, problem detection     |
| `AlertTriangle`  | warnings, errors, security alerts     |
| `Archive`        | archiving, storage, history           |
| `BarChart3`      | charts, dashboards, reporting         |
| `Bell`           | notifications, reminders              |
| `BellRing`       | urgent alerts, incidents, on-call     |
| `Bookmark`       | saved items, favourites               |
| `Bot`            | bots, automation agents               |
| `Brain`          | reasoning, analysis, AI               |
| `Bug`            | bugs, debugging, issue fixing         |
| `Calendar`       | scheduling, events, dates             |
| `Clock`          | time tracking, history, scheduling    |
| `Cloud`          | cloud services, remote resources      |
| `Code2`          | code generation, development          |
| `Compass`        | navigation, discovery, orientation    |
| `Cpu`            | performance, compute, infrastructure  |
| `Database`       | data storage, queries, migrations     |
| `Download`       | fetching, pulling, importing          |
| `Eye`            | monitoring, watching, observability   |
| `File`           | files, documents (generic)            |
| `FileText`       | writing, reports, docs generation     |
| `Filter`         | filtering, processing, triage         |
| `Flag`           | markers, priorities, release flags    |
| `FlaskConical`   | research, experimentation, testing    |
| `Folder`         | directories, repos, workspaces        |
| `GitBranch`      | branching, versioning, worktrees      |
| `GitMerge`       | merging, PRs, code review             |
| `GitPullRequest` | PR management, review workflows       |
| `Globe`          | web, internet, cross-region           |
| `Hammer`         | build, scaffolding, tooling           |
| `Heart`          | health, favourites, wellbeing         |
| `Key`            | authentication, secrets, API keys     |
| `Layers`         | stacks, architecture, layering        |
| `Leaf`           | growth, lightweight, eco              |
| `LifeBuoy`       | support, help, triage, rescue         |
| `Lock`           | security, locking, access control     |
| `Mail`           | email, notifications, messaging       |
| `Map`            | mapping, navigation, planning         |
| `MessageCircle`  | chat, conversation, communication     |
| `Moon`           | night jobs, sleep-time, off-hours     |
| `Network`        | networking, topology, connections     |
| `Package`        | packages, dependencies, releases      |
| `Play`           | run, execute, trigger, launch         |
| `Radar`          | scanning, detection, monitoring       |
| `Radio`          | broadcasting, signals, pub/sub        |
| `RefreshCw`      | sync, refresh, update, retry          |
| `RotateCw`       | rotation, cycling, recurring tasks    |
| `Search`         | search, indexing, discovery           |
| `Server`         | servers, infra, backend services      |
| `Settings`       | configuration, setup, management      |
| `Share2`         | sharing, distribution, publishing     |
| `Shield`         | security, protection, compliance      |
| `ShieldCheck`    | verified security, auditing           |
| `Sparkles`       | AI magic, highlights, special output  |
| `Star`           | favourites, rating, top picks         |
| `Tag`            | tagging, labelling, categorisation    |
| `Terminal`       | CLI, shell commands, scripts          |
| `Timer`          | countdowns, timeouts, deadlines       |
| `Trash2`         | cleanup, purging, data retention      |
| `TrendingUp`     | metrics, growth, analytics            |
| `Upload`         | uploading, publishing, deploying      |
| `User`           | user profiles, identity               |
| `UserCheck`      | user verification, approvals          |
| `Users`          | teams, multi-user, collaboration      |
| `Wand2`          | transformation, magic, generation     |
| `Wifi`           | connectivity, wireless, online checks |
| `Wrench`         | tools, maintenance, configuration     |
| `Zap`            | automation, speed, fast actions       |

---

## Tailwind Color Palettes

Choose a palette that matches the agent's character:

| Palette | `iconBg`                               | `iconColor`                                                 | Character         |
| ------- | -------------------------------------- | ----------------------------------------------------------- | ----------------- |
| Neutral | `bg-secondary group-hover:bg-primary`  | `text-muted-foreground group-hover:text-primary-foreground` | default           |
| Green   | `bg-green-100 group-hover:bg-primary`  | `text-green-700 group-hover:text-primary-foreground`        | success, run      |
| Blue    | `bg-blue-100 group-hover:bg-primary`   | `text-blue-700 group-hover:text-primary-foreground`         | info, details     |
| Purple  | `bg-purple-100 group-hover:bg-primary` | `text-purple-700 group-hover:text-primary-foreground`       | analysis, AI      |
| Yellow  | `bg-yellow-100 group-hover:bg-primary` | `text-yellow-700 group-hover:text-primary-foreground`       | warnings          |
| Red     | `bg-red-100 group-hover:bg-primary`    | `text-red-600 group-hover:text-primary-foreground`          | alerts, incidents |
| Orange  | `bg-orange-100 group-hover:bg-primary` | `text-orange-600 group-hover:text-primary-foreground`       | trending, metrics |
| Slate   | `bg-slate-100 group-hover:bg-primary`  | `text-slate-600 group-hover:text-primary-foreground`        | logs, files       |
