"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SecretFields } from "./secret-fields";
import type { SecretMode } from "./secret-fields";
import type { EnvVar } from "@@/lib/settings-schemas";

interface EditEnvVarDialogProps {
  envVar: EnvVar | null;
  existingKeys: string[];
  onSave: (
    id: string,
    key: string,
    value: string,
    isSecret: boolean,
    keychainService?: string,
    keychainAccount?: string,
  ) => void;
  onClose: () => void;
}

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export function EditEnvVarDialog({ envVar, existingKeys, onSave, onClose }: EditEnvVarDialogProps) {
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  const [isSecret, setIsSecret] = React.useState(false);
  const [secretMode, setSecretMode] = React.useState<SecretMode>("new");
  const [keychainService, setKeychainService] = React.useState("");
  const [keychainAccount, setKeychainAccount] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Sync state whenever the target env var changes
  React.useEffect(() => {
    if (envVar) {
      setKey(envVar.key);
      setValue(envVar.isSecret ? "" : envVar.value);
      setIsSecret(envVar.isSecret);
      setSecretMode(envVar.keychainService ? "link" : "new");
      setKeychainService(envVar.keychainService ?? "");
      setKeychainAccount(envVar.keychainAccount ?? "");
      setError(null);
    }
  }, [envVar]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!envVar) return;

    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError("Key cannot be empty");
      return;
    }
    if (!ENV_KEY_RE.test(trimmedKey)) {
      setError("Key must be SCREAMING_SNAKE_CASE (e.g. MY_TOKEN)");
      return;
    }
    if (trimmedKey !== envVar.key && existingKeys.includes(trimmedKey)) {
      setError(`"${trimmedKey}" already exists`);
      return;
    }
    if (isSecret && secretMode === "link" && !keychainService.trim()) {
      setError("Service name is required when linking an existing keychain entry");
      return;
    }

    onSave(
      envVar.id,
      trimmedKey,
      value,
      isSecret,
      isSecret && secretMode === "link" ? keychainService.trim() : undefined,
      isSecret && secretMode === "link" ? keychainAccount.trim() || undefined : undefined,
    );
    onClose();
  }

  return (
    <Dialog open={envVar !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Environment Variable</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-env-key" className="text-sm font-medium text-on-surface">
              Key
            </label>
            <Input
              id="edit-env-key"
              placeholder="MY_SECRET_TOKEN"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
              }}
              autoFocus
              className="font-mono text-sm"
            />
            {error && <p className="text-xs text-error">{error}</p>}
          </div>

          <SecretFields
            isSecret={isSecret}
            onIsSecretChange={setIsSecret}
            secretMode={secretMode}
            onSecretModeChange={setSecretMode}
            value={value}
            onValueChange={setValue}
            valuePlaceholder={isSecret ? "Leave blank to keep current value" : "Enter value"}
            keychainService={keychainService}
            onKeychainServiceChange={setKeychainService}
            keychainAccount={keychainAccount}
            onKeychainAccountChange={setKeychainAccount}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
