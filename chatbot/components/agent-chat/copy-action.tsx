"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

export function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy"}
      className="relative flex h-6 w-6 items-center justify-center rounded-md border border-border/50 bg-background text-muted-foreground shadow-sm transition-colors duration-150 hover:border-border hover:text-foreground"
    >
      <span
        className="absolute transition-all duration-200"
        style={{
          opacity: copied ? 0 : 1,
          transform: copied ? "scale(0.6)" : "scale(1)",
        }}
      >
        <Copy className="h-3 w-3" />
      </span>
      <span
        className="absolute text-emerald-500 transition-all duration-200"
        style={{
          opacity: copied ? 1 : 0,
          transform: copied ? "scale(1)" : "scale(0.6)",
        }}
      >
        <Check className="h-3 w-3" />
      </span>
    </button>
  );
}
