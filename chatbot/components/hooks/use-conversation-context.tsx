"use client";

import * as React from "react";

interface ConversationContextValue {
  isLoading: boolean;
  activeAgentId: string;
}

const ConversationContext = React.createContext<ConversationContextValue | null>(null);

export function ConversationProvider({
  isLoading,
  activeAgentId,
  children,
}: ConversationContextValue & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ isLoading, activeAgentId }), [isLoading, activeAgentId]);
  return <ConversationContext value={value}>{children}</ConversationContext>;
}

export function useConversationContext(): ConversationContextValue {
  const ctx = React.useContext(ConversationContext);
  if (!ctx) throw new Error("useConversationContext must be used inside ConversationProvider");
  return ctx;
}
