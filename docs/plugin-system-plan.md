# Plan: Decouple Agent Scripts into a Plugin System

## Context

All agent scripts (`agents/memory-dream/`, `agents/get-shit-done/`, etc.) currently live inside the DovePaw monorepo. The user wants to move them to a separate private "plugins marketplace" repo so agents can be dynamically installed and removed. The chatbot's Settings UI must also have a **Plugin Configuration page** that calls the same underlying functions as the CLI. `lib/plugin-manager.ts` is the single shared backend.

**User decisions:**
- Move **all** existing agent scripts to the plugin repo
- `plugin:add` **registers only** (no auto-deploy; user runs `npm run install` manually)
- Include `plugin:update` command
- Chatbot UI with a plugin settings page to add/remove/update plugins and browse their agents

---

## Diagrams

### Plugin Install Flow (CLI + UI)

```
CLI: npm run plugin:add <source>        UI: POST /api/settings/plugins
           │                                         │
           └──────────────┬──────────────────────────┘
                          ▼
              lib/plugin-manager.ts :: addPlugin(source)
                          │
          ┌───────────────┼───────────────────────────────┐
          ▼               ▼                               ▼
   git clone          (local path)            read dovepaw-plugin.json
   ~/.dovepaw/           use as-is            { name, version, agents }
   plugins/{name}/           │                               │
          │                  └──────────────┬───────────────┘
          ▼                                 ▼
   symlink agents/lib ──────────►  for each agent name:
   {pluginDir}/agents/lib            read {pluginDir}/agents/{name}/agent.json
     → {AGENTS_ROOT}/agents/lib      write ~/.dovepaw/settings.agents/{name}/agent.json
                                     (merge pluginPath: pluginDir)
                                               │
                                               ▼
                                    write ~/.dovepaw/plugins.json
                                    return PluginRecord
                                               │
                          ┌────────────────────┤
                          ▼                    ▼
              print "Registered N agents"   200 { plugin: PluginRecord }
              (run npm run install to deploy)
```

---

### Agent Execution Flow (A2A — tsx path) with Plugin

```
Dove UI (browser)
     │  POST /chat
     ▼
chat/route.ts
     │  readAgentsConfig() → AgentDef[]  (includes pluginPath if set)
     │  makeAskTool / makeStartTool per agent
     ▼
Claude Agent SDK query()
     │  calls mcp tool: start_memory_dream
     ▼
QueryAgentExecutor.execute()
     │
     │  scriptRoot = def.pluginPath ?? AGENTS_ROOT
     │                    │
     │          ┌─────────┴──────────┐
     │     plugin agent          core agent
     │    pluginPath set         no pluginPath
     │   ~/.dovepaw/plugins/     DovePaw/agents/
     │   my-plugins/agents/      memory-dream/
     │   memory-dream/main.ts    main.ts
     │          └─────────┬──────────┘
     │                    ▼
     │  ensureAgentSourceSymlink(name, agentSourceDirFromEntry(entryPath, scriptRoot))
     │  scriptPath = join(scriptRoot, entryPath)
     ▼
spawn.ts :: spawnAndCollect()
     │  tsx {scriptPath} "{instruction}"
     │  env: AGENT_WORKSPACE, REPO_LIST, custom vars
     ▼
agents/{name}/main.ts  (in plugin repo or DovePaw)
     │  import "../lib/logger.ts"  → resolves via agents/lib symlink
     ▼
stdout streamed → progress events → Dove UI
```

---

### Chatbot Plugin Settings Page Workflow

```
User opens /settings/plugins
          │
          ▼
page.tsx (server)
  listPlugins() → PluginRecord[]
  → PluginManagementContent (client)
          │
          ├─────────────────────────────────────────────┐
          │  Plugin Card (one per installed plugin)      │
          │  ┌──────────────────────────────────────┐   │
          │  │ dovepaw-plugins                       │   │
          │  │ git@github.com:user/DovePawPlugins   │   │
          │  │ Installed: 2026-04-10                 │   │
          │  │ [Update] [Sync] [Remove]              │   │
          │  │  ▾ 11 agents                          │   │
          │  │    • memory-dream — daily 00:00       │   │
          │  │    • get-shit-done — every 5 min      │   │
          │  │    • blog-writer — on demand          │   │
          │  └──────────────────────────────────────┘   │
          │                                              │
          └──────────────── [+ Add Plugin] ─────────────┘
                                    │
                              ┌─────▼──────┐
                              │ Add Plugin │
                              │ dialog     │
                              │            │
                              │ Source:    │
                              │ [git url   │
                              │  or path]  │
                              │            │
                              │   [Add]    │
                              └────────────┘
                                    │
                    POST /api/settings/plugins { source }
                                    │
                    addPlugin() → PluginRecord
                                    │
                    ← 200 { plugin }
                    refresh plugin list, close dialog
```

---

### Build Flow — Core vs Plugin Agents

```
npm run install  (or  npm run build)
         │
         ▼
tsup.config.ts
  readAgentConfigEntries()
         │
  for each AgentConfigEntry:
    pluginPath set?
    ┌──── yes ────────────────────────────────┐
    │                                         │
    │  entryFile = join(pluginPath,           │  entryFile = "agents/{name}/main.ts"
    │    "agents/{name}/main.ts")  (absolute) │  (relative to DovePaw root)
    └─────────────────┬───────────────────────┘
                      │
                      ▼
  tsup entry map:  { "agents/{name}": entryFile, ... }
         │
         ▼  tsup bundles each agent (imports agents/lib/* resolved via symlink for plugins)
         │
  dist/agents/{name}.mjs   ←── all agents (core + plugin) compiled here
         │
         ▼
  installAgent() per agent:
    deployAgentScript()  ←── copies from dist/agents/{name}.mjs to ~/.dovepaw/cron/
    writePlistFile()
    loadAgent()          ←── launchctl bootstrap
```

---

## Phase 1 — Core Infrastructure: `pluginPath` field

### 1. `lib/agents-config-schemas.ts`
Add to `agentConfigEntrySchema` (inherited by `agentFileSchema` automatically):
```typescript
pluginPath: z.string().optional(),
```

### 2. `lib/agents.ts`
Add to `AgentDef` interface (no new imports — stays Node.js-free for client component safety):
```typescript
/** Absolute path to the plugin repo root. Absent = agent lives in DovePaw/agents/. */
pluginPath?: string;
```
In `buildAgentDef`, pass through: `pluginPath: entry.pluginPath`

### 3. `lib/paths.ts`
Add:
```typescript
export const PLUGINS_DIR = join(DOVEPAW_DIR, "plugins");
export const PLUGINS_REGISTRY_FILE = join(DOVEPAW_DIR, "plugins.json");
```

### 4. `chatbot/a2a/lib/workspace.ts`
Update `agentSourceDirFromEntry` — backward-compatible optional second param:
```typescript
export function agentSourceDirFromEntry(
  entryPath: string,
  scriptRoot: string = AGENTS_ROOT,
): string {
  return join(scriptRoot, dirname(entryPath));
}
```

### 5. `chatbot/a2a/lib/query-agent-executor.ts`
Add `AGENTS_ROOT` to import from `@@/lib/paths`. Replace the two hardcoded `AGENTS_ROOT` usages:
```typescript
const scriptRoot = this.def.pluginPath ?? AGENTS_ROOT;

ensureAgentSourceSymlink(
  this.def.name,
  agentSourceDirFromEntry(this.def.entryPath, scriptRoot),
  publishProgress,
);
// and:
scriptPath: join(scriptRoot, this.def.entryPath),
```

### 6. `tsup.config.ts`
Support absolute plugin entry paths:
```typescript
agentEntries.map((a) => {
  const entryFile = a.pluginPath
    ? join(a.pluginPath, "agents", a.name, "main.ts")
    : `agents/${a.name}/main.ts`;
  return [`agents/${a.name}`, entryFile];
}),
```

### 7. `chatbot/lib/launchd.ts` — `installAgent` fix
The per-agent install uses `agent.entryPath` as tsup entry. For plugin agents this must be absolute:
```typescript
const entryFile = agent.pluginPath
  ? join(agent.pluginPath, agent.entryPath)
  : agent.entryPath;  // relative to AGENTS_ROOT (cwd)

await execAsync(`npx tsup --entry.${agent.name}=${entryFile} --metafile`, {
  cwd: AGENTS_ROOT,
});
```

---

## Phase 2 — Plugin Management Backend (`lib/plugin-manager.ts`)

### 8. `lib/plugin-schemas.ts` (new)
Zod schemas for:
- **`dovepaw-plugin.json`** (plugin repo manifest): `{ name: string, version: string, agents: string[] }`
- **`~/.dovepaw/plugins.json`** (installed registry): `{ version: 1, plugins: PluginRecord[] }`
- **`PluginRecord`**: `{ name, path, gitUrl?, installedAt, agentNames }`

### 9. `lib/plugin-manager.ts` (new)
Single source of truth for all plugin operations — called from both CLI and chatbot API routes.

**`addPlugin(source: string): Promise<PluginRecord>`**
1. Detect Git URL (contains `://` or starts with `git@`) vs local path
2. If Git URL: read `dovepaw-plugin.json` to get name, then `git clone <url> ~/.dovepaw/plugins/{name}/`; if local path: use as-is
3. Read and validate `dovepaw-plugin.json` from plugin root (Zod)
4. Create symlink `{pluginDir}/agents/lib → {AGENTS_ROOT}/agents/lib` if not already present (enables `import "../lib/..."` shared utilities in plugin agents)
5. For each agent name in manifest:
   - Read `{pluginDir}/agents/{name}/agent.json` (partial `AgentConfigEntry` — no `version/repos/envVars/locked`)
   - Write `~/.dovepaw/settings.agents/{name}/agent.json` with `pluginPath` merged in
6. Register/update entry in `~/.dovepaw/plugins.json`
7. Return the `PluginRecord`

**`removePlugin(pluginName: string): Promise<void>`**
1. Find plugin in registry
2. For each agent: delete `~/.dovepaw/settings.agents/{name}/`
3. Remove entry from `~/.dovepaw/plugins.json`
4. *(does not delete the plugin directory itself — user's responsibility)*

**`listPlugins(): Promise<PluginRecord[]>`**
Read and return `~/.dovepaw/plugins.json` plugins array (empty array if file absent).

**`syncPlugin(pluginName: string): Promise<PluginRecord>`**
1. Find plugin in registry; re-read `dovepaw-plugin.json`
2. Remove settings for agents no longer in manifest
3. Upsert settings for agents in manifest (re-read each `agent.json`, write with `pluginPath`)
4. Update `agentNames` in registry entry

**`updatePlugin(pluginName: string): Promise<PluginRecord>`**
1. Find plugin and its `path`
2. Run `git -C {path} pull --ff-only`
3. Call `syncPlugin(pluginName)` to re-sync configs
4. Return updated record

---

## Phase 3 — CLI Interface

### 10. `scripts/plugin.ts` (new)
Routes subcommands (`add`, `remove`, `list`, `sync`, `update`) to `lib/plugin-manager.ts`. Prints results to stdout.

### 11. `package.json` — add scripts
```json
"plugin:add":    "tsx scripts/plugin.ts add",
"plugin:remove": "tsx scripts/plugin.ts remove",
"plugin:update": "tsx scripts/plugin.ts update",
"plugin:sync":   "tsx scripts/plugin.ts sync",
"plugin:list":   "tsx scripts/plugin.ts list"
```

---

## Phase 4 — Chatbot API Routes

### 12. `chatbot/app/api/settings/plugins/route.ts` (new)
```
GET  /api/settings/plugins             → listPlugins()
POST /api/settings/plugins             → addPlugin(body.source)
```

### 13. `chatbot/app/api/settings/plugins/[name]/route.ts` (new)
```
DELETE /api/settings/plugins/[name]    → removePlugin(name)
```

### 14. `chatbot/app/api/settings/plugins/[name]/update/route.ts` (new)
```
POST /api/settings/plugins/[name]/update → updatePlugin(name)
POST /api/settings/plugins/[name]/sync   → syncPlugin(name)
```

All routes follow the existing pattern: Zod-validate request body, call `lib/plugin-manager.ts`, return `NextResponse.json(...)`.

---

## Phase 5 — Chatbot Plugin Settings UI

### 15. `chatbot/app/settings/plugins/page.tsx` (new — server component)
Loads initial plugin list via `listPlugins()` and renders in `SettingsPageLayout`.

### 16. `chatbot/components/settings/plugin-management-content.tsx` (new — client component)
UI with:
- **Header row**: "Installed Plugins" title + "Add Plugin" button (opens dialog)
- **Plugin cards** (one per installed plugin):
  - Plugin name, git URL (if any), install date
  - "Update" button → `POST /api/settings/plugins/[name]/update` (git pull + sync)
  - "Sync" button → re-reads manifest without git pull
  - "Remove" button → `DELETE /api/settings/plugins/[name]` with confirmation
  - Collapsible agent list: agent name, `scheduleDisplay`, `description`
- **Add Plugin dialog**:
  - Text input for Git URL or local filesystem path
  - "Add" button → `POST /api/settings/plugins` → refreshes list on success
  - Shows registered agent count on success
- **Empty state**: prompt to add first plugin when list is empty
- Follows existing patterns: `busy` state, error display, optimistic updates

### 17. Settings navigation update
Add "Plugins" link to the settings nav (wherever the existing tabs/nav lives, likely `settings-page-layout.tsx` or `settings-content.tsx`).

---

## Phase 6 — Move Existing Agents to Plugin Repo

For all 11 agents currently in `DovePaw/agents/` (blog-writer, claude-code-trace-fixer, dependabot-merger, get-shit-done, memory-distiller, memory-dream, oncall-analyzer, release-log-sentinel, security-patcher, yang-persona-distiller, zendesk-triager):

1. Create the external plugin repo structure:
   ```
   DovePawPlugins/
     dovepaw-plugin.json         ← lists all agent names
     agents/
       memory-dream/
         main.ts
         agent.json              ← AgentConfigEntry (no version/repos/envVars/locked/pluginPath)
       get-shit-done/
         main.ts, orchestrator.ts, ...
         agent.json
       ... (all other agents)
   ```
2. Each `agent.json` sourced from existing `~/.dovepaw/settings.agents/{name}/agent.json` (strip runtime fields)
3. Copy all `agents/{name}/` directories to plugin repo
4. Delete `agents/{name}/` directories from DovePaw (keep `agents/lib/` as the shared utility layer)
5. Commit both repos
6. Install: `npm run plugin:add <path-or-url-to-DovePawPlugins>`

---

## Critical Files Summary

| File | Change |
|------|--------|
| `lib/agents-config-schemas.ts` | Add `pluginPath?: string` |
| `lib/agents.ts` | Add `pluginPath?` to `AgentDef`, pass through in `buildAgentDef` |
| `lib/paths.ts` | Add `PLUGINS_DIR`, `PLUGINS_REGISTRY_FILE` |
| `chatbot/a2a/lib/workspace.ts` | `agentSourceDirFromEntry(path, scriptRoot?)` |
| `chatbot/a2a/lib/query-agent-executor.ts` | Resolve `scriptRoot = def.pluginPath ?? AGENTS_ROOT` |
| `tsup.config.ts` | Absolute entry paths for plugin agents |
| `chatbot/lib/launchd.ts` | Per-agent install uses absolute entry path for plugins |
| `package.json` | Add 5 `plugin:*` scripts |
| `lib/plugin-schemas.ts` | **NEW** — Zod schemas |
| `lib/plugin-manager.ts` | **NEW** — shared CRUD operations |
| `scripts/plugin.ts` | **NEW** — CLI |
| `chatbot/app/api/settings/plugins/route.ts` | **NEW** — list + add |
| `chatbot/app/api/settings/plugins/[name]/route.ts` | **NEW** — remove |
| `chatbot/app/api/settings/plugins/[name]/update/route.ts` | **NEW** — update + sync |
| `chatbot/app/settings/plugins/page.tsx` | **NEW** — server page |
| `chatbot/components/settings/plugin-management-content.tsx` | **NEW** — client UI |

---

## Plugin Repo Convention

```
DovePawPlugins/
  dovepaw-plugin.json         ← { "name": "dovepaw-plugins", "version": "1.0.0", "agents": [...] }
  agents/
    {name}/
      main.ts                 ← required: agent entry point
      agent.json              ← required: AgentConfigEntry fields only
      *.ts                    ← optional supporting files
  package.json                ← optional
```

`agents/lib/` is **not in the plugin repo** — symlinked at install time: `{pluginDir}/agents/lib → {AGENTS_ROOT}/agents/lib`.

---

## Tests

- `lib/agents.test.ts` — add: `buildAgentDef` with `pluginPath` propagates to `AgentDef.pluginPath`
- `chatbot/a2a/lib/__tests__/workspace.test.ts` — add: `agentSourceDirFromEntry` with custom `scriptRoot`
- `lib/__tests__/plugin-manager.test.ts` — **NEW**: `addPlugin` (local path), `removePlugin`, `listPlugins`, `updatePlugin`, `syncPlugin`
- `chatbot/app/api/settings/plugins/__tests__/route.test.ts` — **NEW**: API route tests

---

## Verification

1. `npm run plugin:add /path/to/DovePawPlugins` → prints "Registered N agents"
2. Confirm `~/.dovepaw/settings.agents/memory-dream/agent.json` contains `pluginPath`
3. `npm run chatbot:servers` → all plugin agents appear, A2A servers start
4. Send message to agent in Dove UI → spawns script from plugin dir (not DovePaw)
5. `npm run install` → plugin agents compile via tsup (absolute entry paths), deploy as daemons
6. Open `/settings/plugins` in Dove UI → plugin card shows all agents
7. Click "Update" in UI → calls `POST /api/settings/plugins/dovepaw-plugins/update`
8. Click "Remove" in UI → agents disappear from next server start
9. `npm run chatbot:test` → all existing tests pass
