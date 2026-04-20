"use client";

import * as React from "react";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import type { AgentId } from "@/lib/agent-api-urls";
import { useChatSession } from "@/components/hooks/use-chat-session";
import { useAgentSessions } from "@/components/hooks/use-agent-sessions";
import { ChatPane } from "@/components/agent-chat/chat-pane";
import { GroupChatView } from "@/components/agent-chat/group-chat-view";

interface AgentChatProps {
  agentId: string;
  agentConfigs: AgentConfigEntry[];
  groups?: AgentGroup[];
  onIsLoadingChange: (loading: boolean) => void;
  onNewSession: (fn: () => void) => void;
}

export function AgentChat({
  agentId,
  agentConfigs,
  groups = [],
  onIsLoadingChange,
  onNewSession,
}: AgentChatProps) {
  if (agentId.startsWith("group:")) {
    const groupName = agentId.slice("group:".length);
    const memberAgentIds = groups.find((g) => g.name === groupName)?.members ?? [];
    return (
      <GroupChatView
        groupName={groupName}
        memberAgentIds={memberAgentIds}
        agentConfigs={agentConfigs}
        onNewSession={onNewSession}
      />
    );
  }

  return (
    <AgentChatSession
      agentId={agentId as AgentId}
      agentConfigs={agentConfigs}
      onIsLoadingChange={onIsLoadingChange}
      onNewSession={onNewSession}
    />
  );
}

function AgentChatSession({
  agentId,
  agentConfigs,
  onIsLoadingChange,
  onNewSession,
}: {
  agentId: AgentId;
  agentConfigs: AgentConfigEntry[];
  onIsLoadingChange: (loading: boolean) => void;
  onNewSession: (fn: () => void) => void;
}) {
  const session = useChatSession(agentId);
  const { sessions, refresh } = useAgentSessions(agentId);

  // Register a combined clear handler: reset state + refresh history list.
  React.useEffect(() => {
    onNewSession(() => {
      session.newSession();
      void refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent + refresh history when loading changes.
  // useLayoutEffect fires before paint so ConversationContext (and the agent button shimmer)
  // updates in the same frame as the chat UI — prevents the shimmer outlasting the response.
  const prevIsLoadingRef = React.useRef(session.isLoading);
  React.useLayoutEffect(() => {
    if (prevIsLoadingRef.current !== session.isLoading) {
      onIsLoadingChange(session.isLoading);
      void refresh();
    }
    prevIsLoadingRef.current = session.isLoading;
  }, [session.isLoading, onIsLoadingChange, refresh]);

  const runningSessionIds = React.useMemo(() => {
    // Background sessions: DB status (excludes current — DB lags live state).
    const ids = new Set(
      sessions
        .filter((s) => s.status === "running" && s.id !== session.currentSessionId)
        .map((s) => s.id),
    );
    // Current session: live isLoading (reacts instantly to onDone/onCancelled).
    if (session.isLoading && session.currentSessionId) ids.add(session.currentSessionId);
    return ids;
  }, [sessions, session.isLoading, session.currentSessionId]);

  return (
    <ChatPane
      agentId={agentId}
      agentConfigs={agentConfigs}
      messages={session.messages}
      sessionProgress={session.sessionProgress}
      sessionCancelled={session.sessionCancelled}
      isLoading={session.isLoading}
      currentSessionId={session.currentSessionId}
      pendingPermissions={session.pendingPermissions}
      pendingQuestions={session.pendingQuestions}
      pendingQueue={session.pendingQueue}
      sendMessage={session.sendMessage}
      cancelMessage={session.cancelMessage}
      newSession={session.newSession}
      deleteSession={session.deleteSession}
      setSessionId={session.setSessionId}
      resolvePermission={session.resolvePermission}
      resolveQuestion={session.resolveQuestion}
      removeFromQueue={session.removeFromQueue}
      sessions={sessions}
      runningSessionIds={runningSessionIds}
    />
  );
}
