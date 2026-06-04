"use client";

import { Database } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOpenVikingStatus } from "@/components/hooks/use-openviking-status";

/**
 * Top-banner OpenViking status indicator + Web Studio launcher.
 *
 * - Sidecar down → grey dot; click routes to /settings?tab=memory.
 * - Sidecar up → green pulsing dot; click opens the sidecar's built-in Web
 *   Studio (served at /studio) in a new window.
 *
 * Visual matches the other right-side icon buttons in chat-pane.tsx
 * (Bell / Info / Settings).
 */
export function OpenVikingStatusButton() {
  const router = useRouter();
  const { sidecarRunning, studioUrl } = useOpenVikingStatus();

  const title = sidecarRunning
    ? studioUrl
      ? `Open OpenViking Studio (${studioUrl})`
      : "Open OpenViking Studio"
    : "OpenViking is not running — click to configure";

  const handleClick = (): void => {
    if (!sidecarRunning) {
      router.push("/settings?tab=memory");
      return;
    }
    if (studioUrl) window.open(studioUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-label={title}
      className="relative w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
    >
      <Database className="w-4 h-4" />
      <span
        aria-hidden
        className={`absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full ${
          sidecarRunning ? "bg-green-500 dark:bg-green-400 animate-pulse" : "bg-muted-foreground/30"
        }`}
      />
    </button>
  );
}
