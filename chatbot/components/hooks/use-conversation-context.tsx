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

const DEFAULT: ConversationContextValue = { isLoading: false, activeAgentId: "" };

export function useConversationContext(): ConversationContextValue {
  return React.useContext(ConversationContext) ?? DEFAULT;
}
