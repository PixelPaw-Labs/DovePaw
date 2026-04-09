import Database from "better-sqlite3";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DOVEPAW_DIR } from "@@/lib/paths";
import { sessionMessageSchema } from "@/lib/message-types";
import type { SessionMessage } from "@/lib/message-types";
import { mergeProgress } from "@/lib/progress";
import type { ProgressEntry } from "@/lib/progress";

const sessionMessageArraySchema = z.array(sessionMessageSchema);
const progressEntrySchema = z.object({
  message: z.string(),
  artifacts: z.record(z.string(), z.string()),
});
const progressEntryArraySchema = z.array(progressEntrySchema);

export type { SessionMessage };

export type SessionStatus = "running" | "done" | "cancelled" | "interrupted";

function isSessionStatus(value: string): value is SessionStatus {
  return (
    value === "running" || value === "done" || value === "cancelled" || value === "interrupted"
  );
}

function toSessionStatus(value: string): SessionStatus {
  return isSessionStatus(value) ? value : "done";
}

export interface SessionInfo {
  id: string;
  agentId: string;
  startedAt: string;
  label: string;
  status: SessionStatus;
}

export interface SessionDetail {
  id: string;
  agentId: string;
  startedAt: string;
  label: string;
  messages: SessionMessage[];
  progress: ProgressEntry[];
  resumeSeq: number;
  status: SessionStatus;
}

export interface UpsertSessionArgs {
  id: string;
  agentId: string;
  startedAt: string;
  label: string;
  messages: SessionMessage[];
  progress: ProgressEntry[];
  subagentSessionId?: string;
  workspacePath?: string;
  resumeSeq?: number;
  status?: SessionStatus;
}

export interface SessionResumable {
  subagentSessionId: string;
  workspacePath: string;
  startedAt: string;
  label: string;
}

type SessionDetailResult =
  | SessionDetail
  | (Omit<SessionDetail, "resumeSeq"> & { resumeSeq?: number });

let _db: Database.Database | null = null;

export function closeDb(): void {
  _db?.close();
  _db = null;
}

function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DOVEPAW_DIR, { recursive: true });
  _db = new Database(join(DOVEPAW_DIR, "dovepaw.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                      TEXT PRIMARY KEY,
      agent_id                TEXT NOT NULL,
      started_at              TEXT NOT NULL,
      label                   TEXT NOT NULL,
      messages                TEXT NOT NULL DEFAULT '[]',
      progress                TEXT NOT NULL DEFAULT '[]',
      updated_at              TEXT NOT NULL,
      subagent_session_id     TEXT,
      workspace_path          TEXT,
      orchestrator_session_id TEXT,
      subagent_a2a_context_id TEXT
    );
    CREATE TABLE IF NOT EXISTS active_sessions (
      agent_id    TEXT PRIMARY KEY,
      context_id  TEXT
    );
    CREATE TABLE IF NOT EXISTS dove_agent_contexts (
      orchestrator_session_id TEXT NOT NULL,
      manifest_key            TEXT NOT NULL,
      subagent_a2a_context_id TEXT NOT NULL,
      PRIMARY KEY (orchestrator_session_id, manifest_key)
    );
  `);
  const pragmaResult = _db.pragma("table_info(sessions)");
  const cols = Array.isArray(pragmaResult)
    ? pragmaResult.filter(
        (c): c is { name: string } => typeof c === "object" && c !== null && "name" in c,
      )
    : [];
  if (!cols.some((c) => c.name === "status")) {
    _db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'done'");
  }
  if (!cols.some((c) => c.name === "resume_seq")) {
    _db.exec("ALTER TABLE sessions ADD COLUMN resume_seq INTEGER NOT NULL DEFAULT 0");
  }
  return _db;
}

function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  const incomingById = new Map(incoming.map((m) => [m.id, m]));
  const merged = existing.map((m) => incomingById.get(m.id) ?? m);
  const existingIds = new Set(existing.map((m) => m.id));
  return [...merged, ...incoming.filter((m) => !existingIds.has(m.id))];
}

export function upsertSession(args: UpsertSessionArgs): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare<[string], { messages: string; progress: string }>(
      "SELECT messages, progress FROM sessions WHERE id = ?",
    )
    .get(args.id);

  const existingMsgs: SessionMessage[] = existing
    ? sessionMessageArraySchema.parse(JSON.parse(existing.messages))
    : [];
  const existingProgress: ProgressEntry[] = existing
    ? progressEntryArraySchema.parse(JSON.parse(existing.progress))
    : [];

  const mergedMsgs = mergeMessages(existingMsgs, args.messages);
  const mergedProgress = mergeProgress(existingProgress, args.progress);

  const orchestratorSessionId = args.agentId === "dove" ? args.id : null;
  const subagentA2aContextId = args.agentId === "dove" ? null : args.id;

  db.prepare(`
    INSERT INTO sessions (id, agent_id, started_at, label, messages, progress, updated_at,
                          subagent_session_id, workspace_path,
                          orchestrator_session_id, subagent_a2a_context_id, resume_seq, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      messages                = excluded.messages,
      progress                = excluded.progress,
      updated_at              = excluded.updated_at,
      subagent_session_id     = COALESCE(excluded.subagent_session_id, sessions.subagent_session_id),
      workspace_path          = COALESCE(excluded.workspace_path, sessions.workspace_path),
      orchestrator_session_id = COALESCE(sessions.orchestrator_session_id, excluded.orchestrator_session_id),
      subagent_a2a_context_id = COALESCE(sessions.subagent_a2a_context_id, excluded.subagent_a2a_context_id),
      resume_seq              = COALESCE(NULLIF(excluded.resume_seq, 0), sessions.resume_seq),
      status                  = COALESCE(excluded.status, sessions.status)
  `).run(
    args.id,
    args.agentId,
    args.startedAt,
    args.label,
    JSON.stringify(mergedMsgs),
    JSON.stringify(mergedProgress),
    now,
    args.subagentSessionId ?? null,
    args.workspacePath ?? null,
    orchestratorSessionId,
    subagentA2aContextId,
    args.resumeSeq ?? 0,
    args.status ?? "done",
  );
}

export function setActiveSession(agentId: string, contextId: string | null): void {
  getDb()
    .prepare(`
      INSERT INTO active_sessions (agent_id, context_id) VALUES (?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET context_id = excluded.context_id
    `)
    .run(agentId, contextId);
}

export function getActiveSession(agentId: string): string | null {
  const row = getDb()
    .prepare<[string], { context_id: string | null }>(
      "SELECT context_id FROM active_sessions WHERE agent_id = ?",
    )
    .get(agentId);
  return row?.context_id ?? null;
}

export function getSessionStatus(id: string): SessionStatus | null {
  const row = getDb()
    .prepare<[string], { status: string }>("SELECT status FROM sessions WHERE id = ?")
    .get(id);
  return row ? toSessionStatus(row.status) : null;
}

export function setSessionStatus(id: string, status: SessionStatus): void {
  getDb().prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, id);
}

export function markInterruptedSessions(): void {
  getDb().prepare("UPDATE sessions SET status = 'interrupted' WHERE status = 'running'").run();
}

export function setOrchestratorAgentContext(
  orchestratorSessionId: string,
  manifestKey: string,
  subagentA2aContextId: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO dove_agent_contexts (orchestrator_session_id, manifest_key, subagent_a2a_context_id)
       VALUES (?, ?, ?)
       ON CONFLICT(orchestrator_session_id, manifest_key) DO UPDATE SET
         subagent_a2a_context_id = excluded.subagent_a2a_context_id`,
    )
    .run(orchestratorSessionId, manifestKey, subagentA2aContextId);
}

export function getOrchestratorAgentContexts(orchestratorSessionId: string): Map<string, string> {
  const rows = getDb()
    .prepare<[string], { manifest_key: string; subagent_a2a_context_id: string }>(
      "SELECT manifest_key, subagent_a2a_context_id FROM dove_agent_contexts WHERE orchestrator_session_id = ?",
    )
    .all(orchestratorSessionId);
  return new Map(rows.map((r) => [r.manifest_key, r.subagent_a2a_context_id]));
}

export function deleteOrchestratorAgentContexts(orchestratorSessionId: string): void {
  getDb()
    .prepare("DELETE FROM dove_agent_contexts WHERE orchestrator_session_id = ?")
    .run(orchestratorSessionId);
}

export function getSessionResumable(id: string): SessionResumable | null {
  const row = getDb()
    .prepare<
      [string],
      {
        subagent_session_id: string | null;
        workspace_path: string | null;
        started_at: string;
        label: string;
      }
    >("SELECT subagent_session_id, workspace_path, started_at, label FROM sessions WHERE id = ?")
    .get(id);
  if (!row?.subagent_session_id || !row.workspace_path) return null;
  return {
    subagentSessionId: row.subagent_session_id,
    workspacePath: row.workspace_path,
    startedAt: row.started_at,
    label: row.label,
  };
}

export function listSessions(agentId: string): SessionInfo[] {
  return getDb()
    .prepare<
      [string],
      { id: string; agent_id: string; started_at: string; label: string; status: string }
    >(
      "SELECT id, agent_id, started_at, label, status FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC, rowid DESC",
    )
    .all(agentId)
    .map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      startedAt: r.started_at,
      label: r.label,
      status: toSessionStatus(r.status),
    }));
}

export function getSessionDetail(id: string): SessionDetailResult | null {
  const row = getDb()
    .prepare<
      [string],
      {
        id: string;
        agent_id: string;
        started_at: string;
        label: string;
        messages: string;
        progress: string;
        resume_seq: number;
        status: string;
      }
    >(
      "SELECT id, agent_id, started_at, label, messages, progress, resume_seq, status FROM sessions WHERE id = ?",
    )
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    startedAt: row.started_at,
    label: row.label,
    messages: sessionMessageArraySchema.parse(JSON.parse(row.messages)),
    progress: progressEntryArraySchema.parse(JSON.parse(row.progress)),
    resumeSeq: row.resume_seq,
    status: toSessionStatus(row.status),
  };
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  db.prepare("UPDATE active_sessions SET context_id = NULL WHERE context_id = ?").run(id);
  // Cascade to dove_agent_contexts: remove rows where this session was either the
  // orchestrator (Dove session deleted) or the subagent target (subagent session deleted).
  db.prepare("DELETE FROM dove_agent_contexts WHERE orchestrator_session_id = ?").run(id);
  db.prepare("DELETE FROM dove_agent_contexts WHERE subagent_a2a_context_id = ?").run(id);
}
