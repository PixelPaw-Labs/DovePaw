# Migrate group-chat moments to OpenViking

## Context

Commit `b08662f` (April 22) refactored the group-chat reminder in `makeStartScriptTool`. The old reminder had a pre-act read bullet — _"Read `{workspacePath}/chat_histories/` to understand what other agents have already done"_ — which was dropped when `chat_histories/` was replaced by `moments/`. No equivalent read bullet was ported over. Today members are told to **save** to `moments/` but never told to **read** peer moments before acting; the flat-file store also doesn't scale as conversations grow.

This plan restores the pre-act read step over the canonical `moments/` store, using OpenViking (https://github.com/volcengine/OpenViking) as the retrieval + storage layer. Members will query OpenViking with `ov find` before acting and write with `ov add-resource` instead of writing `.md` files directly. Store lifecycle matches the existing per-workspace lifecycle (no cross-session persistence).

## Decisions (confirmed with user)

| Decision    | Choice                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Persistence | **Per workspace** — namespace keyed by the workspace identity; ephemeral, matches current behaviour        |
| Write path  | **Replace** — reminder instructs agents to call `ov add-resource` instead of writing `.md`. No dual-write. |
| Sidecar     | **Spawn from `chatbot/a2a/start-all.ts`** alongside A2A servers; port registered in existing port manifest |

## Prerequisites

OpenViking isn't npm-installable — requires a one-time host install, documented in the DovePaw install README (not scripted as a postinstall to avoid surprising users):

1. `curl -fsSL https://raw.githubusercontent.com/volcengine/OpenViking/main/crates/ov_cli/install.sh | bash` — installs the `ov` Rust CLI.
2. `pip install openviking --upgrade` — installs the `openviking-server` Python package.

Document both commands in the existing README install section. No automation.

## Files to modify / add

### Modify

- **`chatbot/lib/agent-tools.ts:316-324`** — the group-chat `<reminder>` block inside `makeStartScriptTool`. Add a pre-act **read** bullet and replace the **save** bullet so it uses `ov`. The `MOMENTS_PATTERN` constant (lines 57-79) stays — the caveman style rules still apply to resource content; only the "File rules" sub-section needs rewording from "one file per item / name clearly" to "one resource per item / clear resource name" (no behavioural change, just lexicon).

  New reminder shape (around the `viking://` URI keyed on the workspace):

  ```
  You are participating in a group task. Before starting:
  - Read {workspacePath}/members/roster.md ...                                  (unchanged)
  - Query past moments before acting: run `ov find <topic>` against             (new read bullet)
    viking://workspace/<workspaceId>/moments to see what members already
    decided or produced.
  - Save moments with `ov add-resource viking://workspace/<workspaceId>/moments/<name>` (replaces the raw .md save bullet)
    when: decision reached, artifact complete, insight worth sharing.
    Writing style: (MOMENTS_PATTERN as today)
  ```

  The `<workspaceId>` is derived from `config.workspacePath` — use the existing slug-contextId already in the path (set at `query-tools.ts:250-253`).

- **`chatbot/lib/query-tools.ts:236-303`** — `makeInitGroupTool`. Remove the `mkdir(join(groupWorkspacePath, "moments"), { recursive: true })` at line 254 (no longer a filesystem folder). Replace with an `ov` bootstrap call that creates the namespace `viking://workspace/<slug-contextId>/moments`. Keep `members/roster.md` mkdir + write untouched.

- **`chatbot/a2a/start-all.ts`** — spawn `openviking-server` as a sidecar alongside A2A servers. Allocate a port via the existing `getAvailablePort()` (`chatbot/a2a/lib/base-server.ts:79-92`). Pass the port to `writePortsManifest` (`chatbot/a2a/lib/ports-manifest.ts:19`) under key `openviking`. Health-check with a simple HTTP probe before declaring boot complete — if the server isn't running, `ov` calls will silently fail and members will lose memory with no fallback, so boot should fail loudly.

- **`chatbot/lib/__tests__/agent-tools.test.ts:308-312`** — existing assertions check the reminder contains `roster.md`, `moments/` path, and `MOMENTS_PATTERN` text. Update:
  - Keep the `roster.md` assertion.
  - Replace the `moments/` path assertion with one that asserts the reminder contains `ov find` **and** `ov add-resource` **and** a `viking://workspace/` URI.
  - Keep the `MOMENTS_PATTERN` content assertion.

  Follow "tests first" — write the updated assertions before editing the reminder source, watch them fail, then make them pass.

### Add

- **`chatbot/a2a/lib/openviking-sidecar.ts`** — new module mirroring the shape of `base-server.ts`. Responsibilities:
  - `startOpenVikingSidecar(port: number): Promise<ChildProcess>` — spawn `openviking-server --port <port>`, return the handle.
  - `waitForOpenVikingReady(port: number): Promise<void>` — poll `GET http://localhost:<port>/health` (or equivalent; confirm the exact endpoint by reading the OpenViking README on adoption) until it responds, with a bounded timeout.
  - `ensureOpenVikingNamespace(port: number, uri: string): Promise<void>` — used by `makeInitGroupTool` to bootstrap `viking://workspace/<id>/moments` at group init. Shell out to `ov` with `OV_SERVER_URL=http://localhost:<port>`.

  Reuse the existing child-process patterns from `chatbot/a2a/lib/spawn.ts` for consistency.

## Not in scope

- Cross-session persistence (user chose per-workspace — store dies with the workspace).
- Backfill of existing on-disk `moments/*.md` files from prior sessions.
- File watcher / dual-write fallback.
- Exposing OpenViking as an MCP tool to the chatbot layer (the CLI via reminder is enough for now).
- Plugin-level changes. Plugins keep their existing `main.ts` — the reminder steers behaviour, not hardcoded plugin code.

## Known risks

1. **No fallback if `openviking-server` is down** — the replace strategy means a down server silently drops every moment. Mitigated by the boot health check (fail loudly at startup). Runtime crashes are still a hole; worth a follow-up with a PostToolUse hook that detects `ov` non-zero exit and warns.
2. **Python runtime becomes a hard dep** — acceptable per decisions, but call it out in the README.
3. **Debuggability regression** — `moments/*.md` was human-readable via any editor. After migration, inspecting group memory requires `ov ls` / `ov tree`. Accept this as the cost of the retrieval model.
4. **OpenViking is "early stages"** per its README. Pin a specific version in the install docs so a breaking upstream change doesn't wedge DovePaw silently.

## Verification

End-to-end check to confirm the migration works before declaring done:

1. **Unit** — `npm test -- agent-tools.test.ts` passes with the updated reminder assertions.
2. **Boot** — start DovePaw locally (`npm run dev` in chatbot/). Confirm `~/.dovepaw/.ports.7473.json` contains an `openviking` entry and `curl http://localhost:<port>/health` returns 200.
3. **Init** — in the chatbot UI, trigger `init_group_*` on any group. Confirm `ov tree viking://workspace/<id>/moments` returns an empty namespace (not "not found").
4. **Round-trip** — send a task via `start_group_*` that should produce a moment. Confirm via `ov ls viking://workspace/<id>/moments` that at least one resource was written. Then send a follow-up task referencing prior context; confirm the member's transcript shows an `ov find` call and uses the returned content in its response.
5. **Failure mode** — kill `openviking-server` mid-session. Confirm the next agent turn surfaces a visible error (not silent drop) — this validates the boot-fail-loudly design survives runtime crashes too.

## Open questions for implementation time (not blockers for approval)

- Exact name and shape of the OpenViking namespace bootstrap call (`ov add-resource` on an empty URI? a dedicated `ov init`?) — resolve by reading the `ov --help` output once the CLI is installed locally.
- Whether `openviking-server` binds to a deterministic port or `0` + discovery. Decision: use `getAvailablePort()` like A2A servers, publish via port manifest.
