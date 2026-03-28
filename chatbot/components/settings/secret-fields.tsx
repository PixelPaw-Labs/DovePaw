"use client";

/**
 * Shared "Secret" toggle + New-vs-Link radio used in both Add and Edit dialogs.
 */

import * as React from "react";
import { Lock, Eye, Link2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SecretMode = "new" | "link";

export interface SecretFieldsProps {
  isSecret: boolean;
  onIsSecretChange: (v: boolean) => void;
  secretMode: SecretMode;
  onSecretModeChange: (v: SecretMode) => void;
  value: string;
  onValueChange: (v: string) => void;
  keychainService: string;
  onKeychainServiceChange: (v: string) => void;
  keychainAccount: string;
  onKeychainAccountChange: (v: string) => void;
}

export function SecretFields({
  isSecret,
  onIsSecretChange,
  secretMode,
  onSecretModeChange,
  value,
  onValueChange,
  keychainService,
  onKeychainServiceChange,
  keychainAccount,
  onKeychainAccountChange,
}: SecretFieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Value field — only shown for non-secret or new-secret */}
      {(!isSecret || secretMode === "new") && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="secret-value" className="text-sm font-medium text-on-surface">
            Value
          </label>
          <Input
            id="secret-value"
            type={isSecret ? "password" : "text"}
            placeholder="Enter value"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
      )}

      {/* Secret toggle */}
      <button
        type="button"
        onClick={() => onIsSecretChange(!isSecret)}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
          isSecret
            ? "border-primary/40 bg-primary/8 text-primary"
            : "border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-outline-variant/60"
        }`}
      >
        <div
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            isSecret ? "border-primary bg-primary" : "border-outline-variant/50 bg-transparent"
          }`}
        >
          {isSecret && (
            <svg viewBox="0 0 12 12" className="w-3 h-3 text-on-primary fill-current">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
        {isSecret ? (
          <Lock className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Eye className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="font-medium">
          {isSecret ? "Secret — stored in OS keychain" : "Plain — stored in settings file"}
        </span>
      </button>

      {/* New vs Link radio — only shown when secret is on */}
      {isSecret && (
        <div className="flex flex-col gap-2 pl-1">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
            Storage
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSecretModeChange("new")}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm flex-1 transition-colors ${
                secretMode === "new"
                  ? "border-primary/50 bg-primary/8 text-primary"
                  : "border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-outline-variant/60"
              }`}
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">New in Dovepaw</span>
            </button>
            <button
              type="button"
              onClick={() => onSecretModeChange("link")}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm flex-1 transition-colors ${
                secretMode === "link"
                  ? "border-primary/50 bg-primary/8 text-primary"
                  : "border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-outline-variant/60"
              }`}
            >
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">Link existing</span>
            </button>
          </div>

          {/* Link fields */}
          {secretMode === "link" && (
            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant/20 bg-surface-container p-3">
              <p className="text-xs text-on-surface-variant">
                Dovepaw will read this entry but never modify or delete it.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="keychain-service"
                    className="text-xs font-medium text-on-surface-variant"
                  >
                    Service
                  </label>
                  <Input
                    id="keychain-service"
                    placeholder="e.g. aws"
                    value={keychainService}
                    onChange={(e) => onKeychainServiceChange(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="keychain-account"
                    className="text-xs font-medium text-on-surface-variant"
                  >
                    Account
                  </label>
                  <Input
                    id="keychain-account"
                    placeholder="e.g. default"
                    value={keychainAccount}
                    onChange={(e) => onKeychainAccountChange(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
