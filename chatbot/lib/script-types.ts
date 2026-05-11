/** Shared types for agent script run results. Used by both chatbot/lib and chatbot/a2a/lib. */

export type ScriptCompletedContent = {
  status: "completed";
  runId: string;
  output: string;
  durationMs: number;
};

export type ScriptStillRunningContent = {
  status: "still_running";
  runId: string;
};

export type ScriptNotFoundContent = {
  status: "not_found";
  runId: string;
};

export type AwaitScriptContent =
  | ScriptCompletedContent
  | ScriptStillRunningContent
  | ScriptNotFoundContent;
