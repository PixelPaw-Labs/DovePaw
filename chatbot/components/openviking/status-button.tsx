"use client";

import * as React from "react";
import { Database } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOpenVikingStatus } from "@/components/hooks/use-openviking-status";

/**
 * Top-banner OpenViking status indicator + console launcher.
 *
 * - Sidecar down → grey dot; click routes to /settings?tab=openviking.
 * - Sidecar up → green pulsing dot; click launches the console (if needed)
 *   and opens it in a new tab.
 *
 * Visual matches the other right-side icon buttons in chat-pane.tsx
 * (Bell / Info / Settings).
 */
export function OpenVikingStatusButton() {
  const router = useRouter();
  const { sidecarRunning, consoleUrl, launching, launchConsole } = useOpenVikingStatus();

  const title = sidecarRunning
    ? launching
      ? "Starting OpenViking console…"
      : consoleUrl
        ? `Open OpenViking console (${consoleUrl})`
        : "Open OpenViking console"
    : "OpenViking is not running — click to configure";

  const handleClick = async (): Promise<void> => {
    if (!sidecarRunning) {
      router.push("/settings?tab=memory");
      return;
    }
    if (consoleUrl) {
      window.open(consoleUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const url = await launchConsole();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={title}
      aria-label={title}
      className="relative w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
    >
      <Database className="w-4 h-4" />
      <span
        aria-hidden
        className={`absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full ${
          sidecarRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"
        }`}
      />
    </button>
  );
}
