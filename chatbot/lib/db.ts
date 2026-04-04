import "server-only";
import Database from "better-sqlite3";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DOVEPAW_DIR } from "@@/lib/paths";
import { sessionMessageSchema } from "@/lib/message-types";
import type { SessionMessage } from "@/lib/message-types";
import type { ProgressEntry } from "@/lib/query-tools";

const sessionMessageArraySchema = z.array(sessionMessageSchema);
const progressEntrySchema = z.object({
  message: z.string(),
  artifacts: z.record(z.string(), z.string()),
});
const progressEntryArraySchema = z.array(progressEntrySchema);

export type { SessionMessage };

export interface SessionInfo {
  contextId: string;
  agentId: string;
  startedAt: string;
  label: string;
}

export interface SessionDetail {
  contextId: string;
  agentId: string;
  startedAt: string;
  label: string;
  messages: SessionMessage[];
  progress: ProgressEntry[];
}

export interface UpsertSessionArgs {
  contextId: string;
  agentId: string;
  startedAt: string;
  label: string;
  messages: SessionMessage[];
  progress: ProgressEntry[];
}

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
      context_id  TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      label       TEXT NOT NULL,
      messages    TEXT NOT NULL DEFAULT '[]',
      progress    TEXT NOT NULL DEFAULT '[]',
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS active_sessions (
      agent_id    TEXT PRIMARY KEY,
      context_id  TEXT
    );
  `);
  return _db;
}

export function upsertSession(args: UpsertSessionArgs): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare<[string], { messages: string; progress: string }>(
      "SELECT messages, progress FROM sessions WHERE context_id = ?",
    )
    .get(args.contextId);

  const existingMsgs: SessionMessage[] = existing
    ? sessionMessageArraySchema.parse(JSON.parse(existing.messages))
    : [];
  const existingProgress: ProgressEntry[] = existing
    ? progressEntryArraySchema.parse(JSON.parse(existing.progress))
    : [];

  const mergedMsgs = [...existingMsgs, ...args.messages];
  const mergedProgress = [...existingProgress];
  for (const entry of args.progress) {
    const isDupe = mergedProgress.some(
      (e) =>
        e.message === entry.message &&
        JSON.stringify(e.artifacts) === JSON.stringify(entry.artifacts),
    );
    if (!isDupe) mergedProgress.push(entry);
  }

  db.prepare(`
    INSERT INTO sessions (context_id, agent_id, started_at, label, messages, progress, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(context_id) DO UPDATE SET
      messages   = excluded.messages,
      progress   = excluded.progress,
      updated_at = excluded.updated_at
  `).run(
    args.contextId,
    args.agentId,
    args.startedAt,
    args.label,
    JSON.stringify(mergedMsgs),
    JSON.stringify(mergedProgress),
    now,
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

export function listSessions(agentId: string): SessionInfo[] {
  return getDb()
    .prepare<[string], { context_id: string; agent_id: string; started_at: string; label: string }>(
      "SELECT context_id, agent_id, started_at, label FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC, rowid DESC",
    )
    .all(agentId)
    .map((r) => ({
      contextId: r.context_id,
      agentId: r.agent_id,
      startedAt: r.started_at,
      label: r.label,
    }));
}

export function getSessionDetail(contextId: string): SessionDetail | null {
  const row = getDb()
    .prepare<
      [string],
      {
        context_id: string;
        agent_id: string;
        started_at: string;
        label: string;
        messages: string;
        progress: string;
      }
    >("SELECT * FROM sessions WHERE context_id = ?")
    .get(contextId);
  if (!row) return null;
  return {
    contextId: row.context_id,
    agentId: row.agent_id,
    startedAt: row.started_at,
    label: row.label,
    messages: sessionMessageArraySchema.parse(JSON.parse(row.messages)),
    progress: progressEntryArraySchema.parse(JSON.parse(row.progress)),
  };
}

export function deleteSession(contextId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE context_id = ?").run(contextId);
  db.prepare("UPDATE active_sessions SET context_id = NULL WHERE context_id = ?").run(contextId);
}
