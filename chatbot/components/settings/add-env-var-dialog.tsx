"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SecretFields } from "./secret-fields";
import type { SecretMode } from "./secret-fields";

interface AddEnvVarDialogProps {
  existingKeys: string[];
  onAdd: (
    key: string,
    value: string,
    isSecret: boolean,
    keychainService?: string,
    keychainAccount?: string,
  ) => void;
}

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export function AddEnvVarDialog({ existingKeys, onAdd }: AddEnvVarDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  const [isSecret, setIsSecret] = React.useState(false);
  const [secretMode, setSecretMode] = React.useState<SecretMode>("new");
  const [keychainService, setKeychainService] = React.useState("");
  const [keychainAccount, setKeychainAccount] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedKey = key.trim();

    if (!trimmedKey) {
      setError("Key cannot be empty");
      return;
    }
    if (!ENV_KEY_RE.test(trimmedKey)) {
      setError("Key must be SCREAMING_SNAKE_CASE (e.g. MY_TOKEN)");
      return;
    }
    if (existingKeys.includes(trimmedKey)) {
      setError(`"${trimmedKey}" already exists`);
      return;
    }
    if (isSecret && secretMode === "link" && !keychainService.trim()) {
      setError("Service name is required when linking an existing keychain entry");
      return;
    }

    onAdd(
      trimmedKey,
      value,
      isSecret,
      isSecret && secretMode === "link" ? keychainService.trim() : undefined,
      isSecret && secretMode === "link" ? keychainAccount.trim() || undefined : undefined,
    );
    reset();
    setOpen(false);
  }

  function reset() {
    setKey("");
    setValue("");
    setIsSecret(false);
    setSecretMode("new");
    setKeychainService("");
    setKeychainAccount("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Add Variable
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Environment Variable</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="env-key" className="text-sm font-medium text-on-surface">
              Key
            </label>
            <Input
              id="env-key"
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
            keychainService={keychainService}
            onKeychainServiceChange={setKeychainService}
            keychainAccount={keychainAccount}
            onKeychainAccountChange={setKeychainAccount}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
