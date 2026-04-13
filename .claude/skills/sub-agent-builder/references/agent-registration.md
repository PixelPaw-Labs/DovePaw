# Agent Registration Reference

## agent.json Template

Write to `~/.dovepaw/tmp/<name>/agent.json`. Do NOT include `pluginPath` — it is added at publish time.

```json
{
  "version": 1,
  "name": "{{NAME}}",
  "alias": "{{ALIAS}}",
  "displayName": "{{DISPLAY_NAME}}",
  "description": "{{MCP_TOOL_DESCRIPTION}}",
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
      "title": "Run now",
      "description": "Run {{DISPLAY_NAME}} now",
      "prompt": "Run {{DISPLAY_NAME}} now"
    },
    {
      "title": "What does it do?",
      "description": "What does {{DISPLAY_NAME}} do?",
      "prompt": "What does {{DISPLAY_NAME}} do?"
    },
    {
      "title": "Last run logs",
      "description": "Show {{DISPLAY_NAME}} logs",
      "prompt": "Show {{DISPLAY_NAME}} logs"
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
  { "key": "JIRA_API_KEY", "value": "", "isSecret": true },
  { "key": "REPO_LIST", "value": "", "isSecret": false }
]
```

---

## Icon Catalog (Lucide names)

Pick the icon that best matches the agent's purpose:

| Icon             | Purpose                          |
| ---------------- | -------------------------------- |
| `Brain`          | reasoning, analysis, AI          |
| `Zap`            | automation, fast actions         |
| `Radar`          | monitoring, detection            |
| `FlaskConical`   | research, experimentation        |
| `BellRing`       | alerts, notifications, incidents |
| `LifeBuoy`       | support, help, triage            |
| `GitMerge`       | git, PRs, code review            |
| `Play`           | run, execute, trigger            |
| `FileText`       | documents, writing, reports      |
| `BookOpen`       | reading, notes, knowledge        |
| `ListTodo`       | tasks, tickets, backlog          |
| `GitPullRequest` | PRs, review, merge               |
| `AlertTriangle`  | warnings, errors, security       |
| `RefreshCw`      | sync, refresh, update            |
| `TrendingUp`     | metrics, growth, analytics       |
| `Clock`          | scheduling, time, history        |
| `Search`         | discovery, search, indexing      |
| `CheckCircle`    | validation, approval, done       |
| `Eye`            | monitoring, watching             |
| `Info`           | information, status              |
| `Hammer`         | build, scaffolding, tooling      |

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
