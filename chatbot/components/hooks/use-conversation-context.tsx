"use client";

import * as React from "react";

interface ConversationContextValue {
  isLoading: boolean;
  activeAgentId: string;
  /** True whenever any Dove session is running — survives switching away from Dove. */
  doveIsRunning: boolean;
}

const ConversationContext = React.createContext<ConversationContextValue | null>(null);

export function ConversationProvider({
  isLoading,
  activeAgentId,
  doveIsRunning,
  children,
}: ConversationContextValue & { children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ isLoading, activeAgentId, doveIsRunning }),
    [isLoading, activeAgentId, doveIsRunning],
  );
  return <ConversationContext value={value}>{children}</ConversationContext>;
}

const DEFAULT: ConversationContextValue = {
  isLoading: false,
  activeAgentId: "",
  doveIsRunning: false,
};

export function useConversationContext(): ConversationContextValue {
  return React.useContext(ConversationContext) ?? DEFAULT;
}
