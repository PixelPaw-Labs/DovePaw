"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { MessageAction } from "@/components/ai-elements/message";

export function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <MessageAction tooltip={copied ? "Copied!" : "Copy"} onClick={handleCopy}>
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </MessageAction>
  );
}
