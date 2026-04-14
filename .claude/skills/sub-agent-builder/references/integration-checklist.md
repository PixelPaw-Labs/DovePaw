# Integration Checklist

## After Scaffolding (tmp agent in Kiln)

Run from the DovePaw project root:

```bash
npm run lint
npm run fmt
npm run chatbot:test
```

The agent is now visible in the **Kiln** sidebar group (Sparkles icon). Tmp agents are auto-discovered — no restart required.

## Path Reference

| Path                               | Purpose                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `~/.dovepaw/tmp/<name>/main.ts`    | Agent entry point (tmp draft)                                        |
| `~/.dovepaw/tmp/<name>/agent.json` | Agent metadata (tmp draft) — `tmpAgentDefinitionFile(name)`          |
| `~/.dovepaw/agents/logs/.<name>/`  | Persistent log dir (`agentPersistentLogDir(name)`)                   |
| `~/.dovepaw/agents/state/.<name>/` | Persistent state dir — Type 3 only (`agentPersistentStateDir(name)`) |

## After Publishing to Plugin Repo

Paths in the plugin repo after move:

| Path                        | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `agents/<name>/main.ts`     | Agent entry point                                               |
| `agents/<name>/agent.json`  | Agent metadata (with `pluginPath` field)                        |
| `skills/<name>/SKILL.md`    | Associated skill (if created in Phase 4)                        |
| `skills/<name>/scripts/`    | Helper scripts for the skill (optional)                         |
| `skills/<name>/references/` | Reference docs read by the skill (optional)                     |
| `skills/<name>/steps/`      | Sub-phase instructions for multi-phase skills (optional)        |
| `dovepaw-plugin.json`       | Plugin manifest — `<name>` added to `agents` AND `skills` array |

When a skill was created in Phase 4, update `dovepaw-plugin.json`:

```json
{
  "agents": ["existing-agent", "<name>"],
  "skills": ["existing-skill", "<name>"]
}
```

Both arrays are independent — add to whichever apply.

### Install and restart

```bash
# In DovePaw project root — creates launchd plist (confirm with user first):
npm run install

# Restart A2A servers to register the new agent:
npm run chatbot:servers
```

## Execution note

User-triggered A2A runs invoke `tsx agents/<name>/main.ts` (TypeScript source directly).
`npm run build` compiles to `.mjs` for launchd scheduled daemons only.
