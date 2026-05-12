# Migrate group-chat moments to OpenViking

## Context

Commit `b08662f` (April 22) refactored the group-chat reminder in `makeStartScriptTool`. The old reminder had a pre-act read bullet — _"Read `{workspacePath}/chat_histories/` to understand what other agents have already done"_ — which was dropped when `chat_histories/` was replaced by `moments/`. No equivalent read bullet was ported over. Today members are told to **save** to `moments/` but never told to **read** peer moments before acting; the flat-file store also doesn't scale as conversations grow.

This plan restores the pre-act read step over the canonical `moments/` store, using OpenViking (https://github.com/volcengine/OpenViking) as the retrieval + storage layer. Members will query OpenViking with `ov find` before acting and write with `ov add-resource` instead of writing `.md` files directly. Store lifecycle matches the existing per-workspace lifecycle (no cross-session persistence).

## Decisions (confirmed with user)

| Decision    | Choice                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence | **Per workspace** — namespace keyed by the workspace identity; ephemeral, matches current behaviour                                                                                                                                                                                               |
| Write path  | **Replace** — reminder instructs agents to call `ov add-resource` instead of writing `.md`. No dual-write.                                                                                                                                                                                        |
| Sidecar     | **Spawn from `chatbot/a2a/start-all.ts`** alongside A2A servers; port registered in existing port manifest                                                                                                                                                                                        |
| Auth        | **`api_key` mode with auto-provisioned `dovepaw/local` user** — sidecar boots with a generated `root_api_key`; first boot creates account `dovepaw` and user `local` via the Admin API and saves the returned user key to `~/.dovepaw/openviking/ovcli.conf`. All `ov` calls use that user key.   |
| Scope model | **One group = one `agent_id`** — each group chat uses a dedicated `agent_id` (e.g. derived from the group workspace slug). All members pass `--agent-id <group_id>` to every `ov` call. `viking://agent/<group_id>/` provides namespace separation; auth comes from the shared `dovepaw/local` user key (acceptable for a localhost-only sidecar; see Known risks). |

## Prerequisites

OpenViking isn't npm-installable — requires a one-time host install, documented in the DovePaw install README (not scripted as a postinstall to avoid surprising users):

1. `curl -fsSL https://raw.githubusercontent.com/volcengine/OpenViking/main/crates/ov_cli/install.sh | bash` — installs the `ov` Rust CLI.
2. `pip install openviking --upgrade` — installs the `openviking-server` Python package.

Document both commands in the existing README install section. No automation.

DovePaw owns the OpenViking config under `~/.dovepaw/openviking/` (not the user's global `~/.openviking/`) so it can't collide with any standalone OpenViking install the user may already have. On first sidecar boot the directory is created with `ov.conf` (containing a generated `root_api_key`) and `ovcli.conf` (containing the `dovepaw/local` user key after registration completes). Document this directory in the README so users know where local credentials live and can `chmod 600` if they want tighter permissions.

## Files to modify / add

### Modify

- **`chatbot/lib/agent-tools.ts:316-324`** — the group-chat `<reminder>` block inside `makeStartScriptTool`. Add a pre-act **read** bullet and replace the **save** bullet so it uses `ov`. The `MOMENTS_PATTERN` constant (lines 57-79) stays — the caveman style rules still apply to resource content; only the "File rules" sub-section needs rewording from "one file per item / name clearly" to "one resource per item / clear resource name" (no behavioural change, just lexicon).

  New reminder shape (using the `viking://agent/<group_id>/` scope):

  ```
  You are participating in a group task. Before starting:
  - Read {workspacePath}/members/roster.md ...                                  (unchanged)
  - Query past moments before acting: run                                       (new read bullet)
    `ov find <topic> --agent-id <groupContextId>` against
    viking://agent/<groupContextId>/moments to see what members already
    decided or produced.
  - Save moments with                                                           (replaces the raw .md save bullet)
    `ov add-resource --to viking://agent/<groupContextId>/moments/<name> --agent-id <groupContextId>`
    when: decision reached, artifact complete, insight worth sharing.
    Writing style: (MOMENTS_PATTERN as today)
  ```

  The `<groupContextId>` is derived from the group workspace slug (set at `query-tools.ts:250-253`). All members in the same group share the same `agent_id` value, which is also the group boundary — no member of another group can read or write to this scope.

  **Why `viking://agent/<groupContextId>/` instead of `viking://workspace/<workspaceId>/`:** OpenViking's `viking://agent/{agent_id}/` scope gives each group a distinct **namespace**, so the agent_id is what disambiguates one group's moments from another's. Note that with all groups sharing the `dovepaw/local` user key, isolation between groups is namespace-only (not auth-enforced) — a member that knows another group's slug could in principle read its moments. Acceptable for a localhost-only single-user sidecar; revisit if the sidecar ever serves multiple DovePaw instances or non-localhost traffic (see Known risks).

- **`chatbot/lib/query-tools.ts:236-303`** — `makeInitGroupTool`. Remove the `mkdir(join(groupWorkspacePath, "moments"), { recursive: true })` at line 254 (no longer a filesystem folder). Replace with an `ov` bootstrap call that initialises the namespace `viking://agent/<groupContextId>/moments` using `--agent-id <groupContextId>`, where `groupId` is the workspace slug. Keep `members/roster.md` mkdir + write untouched.

- **`chatbot/a2a/start-all.ts`** — spawn `openviking-server` as a sidecar alongside A2A servers. Allocate a port via the existing `getAvailablePort()` (`chatbot/a2a/lib/base-server.ts:79-92`). Pass the port to `writePortsManifest` (`chatbot/a2a/lib/ports-manifest.ts:19`) under key `openviking`. Health-check with a simple HTTP probe before declaring boot complete — if the server isn't running, `ov` calls will silently fail and members will lose memory with no fallback, so boot should fail loudly. After the health probe passes, run `ensureDovepawUser()` (see `openviking-sidecar.ts` below) so that the `dovepaw/local` user exists before any group is initialised. Then export `OPENVIKING_CLI_CONFIG_FILE=~/.dovepaw/openviking/ovcli.conf` into the environment of every child A2A process so each agent's `ov` invocation inherits the tenant identity automatically.

- **`chatbot/lib/__tests__/agent-tools.test.ts:308-312`** — existing assertions check the reminder contains `roster.md`, `moments/` path, and `MOMENTS_PATTERN` text. Update:
  - Keep the `roster.md` assertion.
  - Replace the `moments/` path assertion with one that asserts the reminder contains `ov find` **and** `ov add-resource` **and** a `viking://agent/` URI **and** an `--agent-id` flag.
  - Keep the `MOMENTS_PATTERN` content assertion.

  Follow "tests first" — write the updated assertions before editing the reminder source, watch them fail, then make them pass.

### Add

- **`chatbot/a2a/lib/openviking-sidecar.ts`** — new module mirroring the shape of `base-server.ts`. Responsibilities:
  - `ensureSidecarConfig(): Promise<void>` — run before spawning. If `~/.dovepaw/openviking/ov.conf` is missing, generate a random `root_api_key` (32 bytes hex, via `crypto.randomBytes`) and write the file with `server.auth_mode = "api_key"` and `server.host = "127.0.0.1"`. Idempotent — never overwrites an existing key.
  - `startOpenVikingSidecar(port: number): Promise<ChildProcess>` — spawn `openviking-server --config ~/.dovepaw/openviking/ov.conf --port <port>`, return the handle.
  - `waitForOpenVikingReady(port: number): Promise<void>` — poll `GET http://localhost:<port>/health` (unauthenticated; confirm the exact endpoint by reading the OpenViking README on adoption) until it responds, with a bounded timeout.
  - `ensureDovepawUser(port: number): Promise<void>` — **must run after `waitForOpenVikingReady` and before any group init**. Reads `~/.dovepaw/openviking/ovcli.conf`; if it already contains a non-empty `api_key`, sanity-check by calling `GET /api/v1/fs/ls?uri=viking://` with that key — if it returns 200, do nothing. Otherwise:
    1. Read `root_api_key` from `~/.dovepaw/openviking/ov.conf`.
    2. `POST http://localhost:<port>/api/v1/admin/accounts` with header `X-API-Key: <root-key>` and body `{"account_id": "dovepaw", "admin_user_id": "local"}`. If the response is 409 (account already exists), follow up with `POST /api/v1/admin/accounts/dovepaw/users/local/key` to regenerate the user key instead.
    3. Write the returned `user_key` to `~/.dovepaw/openviking/ovcli.conf` alongside `url: "http://localhost:<port>"`, `account: "dovepaw"`, `user: "local"`. Do **not** write `root_api_key` into `ovcli.conf` — `ov` calls from agents should never have sudo capability.
    4. `chmod 600` the file.

    Idempotent across reboots (existing valid key → no-op) and across `root_api_key` rotations (invalid key → regenerate).
  - `ensureOpenVikingNamespace(port: number, groupId: string): Promise<void>` — used by `makeInitGroupTool` to bootstrap `viking://agent/<groupContextId>/moments` at group init. Shells out to `ov` with `OPENVIKING_CLI_CONFIG_FILE=~/.dovepaw/openviking/ovcli.conf` (so the user key is picked up automatically) and `--agent-id <groupContextId>`. No need to pass `OV_SERVER_URL` — the URL is in `ovcli.conf`.

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
5. **Shared `dovepaw/local` user key** — every group passes the same user identity to the sidecar, so cross-group isolation is namespace-only. A member that learns another group's slug could read its moments. Acceptable because the sidecar binds to `127.0.0.1` and serves only the local DovePaw instance. Revisit if the sidecar is ever exposed beyond localhost or shared across DovePaw instances — at that point, per-group users (one Admin API call per group at init time, keyed by group slug) would replace the shared user key.
6. **`root_api_key` lives on disk** — `~/.dovepaw/openviking/ov.conf` holds the root key in plain text. It's never sent to agents (only `ovcli.conf` with the user key is exported to child processes), but file permissions still matter. `ensureSidecarConfig` writes with mode `0600`; document this so users running DovePaw on shared machines can verify.

## Verification

End-to-end check to confirm the migration works before declaring done:

1. **Unit** — `npm test -- agent-tools.test.ts` passes with the updated reminder assertions.
2. **Boot** — start DovePaw locally (`npm run dev` in chatbot/). Confirm `~/.dovepaw/.ports.7473.json` contains an `openviking` entry and `curl http://localhost:<port>/health` returns 200.
3. **User registration** — confirm `~/.dovepaw/openviking/ovcli.conf` exists, has `account: "dovepaw"`, `user: "local"`, a non-empty `api_key`, file mode `0600`, and **no** `root_api_key`. Confirm `OPENVIKING_CLI_CONFIG_FILE=~/.dovepaw/openviking/ovcli.conf ov ls viking://` returns 200 (proves the user key is valid and the `INVALID_ARGUMENT: ROOT requests…` error does not occur). Then delete `ovcli.conf` and restart the sidecar — confirm the file is re-created via the regenerate-key fallback (idempotency check).
4. **Init** — in the chatbot UI, trigger `init_group_*` on any group. Confirm `ov tree viking://agent/<groupContextId>/moments --agent-id <groupContextId>` returns an empty namespace (not "not found").
5. **Round-trip** — send a task via `start_group_*` that should produce a moment. Confirm via `ov ls viking://agent/<groupContextId>/moments --agent-id <groupContextId>` that at least one resource was written. Then send a follow-up task referencing prior context; confirm the member's transcript shows an `ov find --agent-id <groupContextId>` call and uses the returned content in its response.
6. **Failure mode** — kill `openviking-server` mid-session. Confirm the next agent turn surfaces a visible error (not silent drop) — this validates the boot-fail-loudly design survives runtime crashes too.

## Open questions for implementation time (not blockers for approval)

- Exact name and shape of the OpenViking namespace bootstrap call (`ov add-resource` on an empty URI? a dedicated `ov init`?) — resolve by reading the `ov --help` output once the CLI is installed locally.
- Whether `openviking-server` binds to a deterministic port or `0` + discovery. Decision: use `getAvailablePort()` like A2A servers, publish via port manifest.
