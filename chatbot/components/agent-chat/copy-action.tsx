"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { MessageAction } from "@/components/ai-elements/message";

export function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <MessageAction tooltip={copied ? "Copied!" : "Copy"} onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </MessageAction>
  );
}
