"use client";

import type { ChatSsePermission } from "@/lib/chat-sse";
import {
  Confirmation,
  ConfirmationIcon,
  ConfirmationBody,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
} from "@/components/ai-elements/confirmation";
import { Check, X } from "lucide-react";

interface PermissionBannerProps {
  request: ChatSsePermission;
  onAllow: () => void;
  onDeny: () => void;
}

function getFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const fp: unknown = Reflect.get(toolInput, "file_path");
  return typeof fp === "string" ? fp : undefined;
}

function describeRequest(toolName: string, toolInput: unknown): string {
  const filePath = getFilePath(toolInput);
  return filePath ? `${toolName} → ${filePath}` : toolName;
}

export function PermissionBanner({ request, onAllow, onDeny }: PermissionBannerProps) {
  const description = describeRequest(request.toolName, request.toolInput);

  return (
    <Confirmation state="pending">
      <ConfirmationIcon state="pending" />
      <ConfirmationBody>
        <ConfirmationTitle>Permission required</ConfirmationTitle>
        <ConfirmationRequest>
          {request.title ?? (
            <>
              Claude wants to run <span className="font-mono text-foreground">{description}</span>
            </>
          )}
        </ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction variant="default" size="sm" onClick={onAllow}>
            <Check className="size-3 mr-1" />
            Allow
          </ConfirmationAction>
          <ConfirmationAction variant="outline" size="sm" onClick={onDeny}>
            <X className="size-3 mr-1" />
            Deny
          </ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationBody>
    </Confirmation>
  );
}
