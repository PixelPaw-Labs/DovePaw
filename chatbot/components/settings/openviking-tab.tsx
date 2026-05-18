"use client";

import * as React from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Shape we accept from GET /api/openviking/config. We're permissive on read
// because the user's ~/.openviking/ov.conf may have extra fields we should
// preserve round-trip.
const configShape = z
  .object({
    embedding: z
      .object({
        dense: z
          .object({
            provider: z.string().optional(),
            model: z.string().optional(),
            api_key: z.string().optional(),
            api_base: z.string().optional(),
            dimension: z.number().optional(),
          })
          .default({}),
      })
      .default({ dense: {} }),
    storage: z.object({ workspace: z.string().optional() }).default({}),
    vlm: z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
        api_base: z.string().optional(),
        temperature: z.number().optional(),
        max_retries: z.number().optional(),
      })
      .default({}),
  })
  .passthrough();

const getResponseSchema = z.object({
  config: configShape.nullable(),
  source: z.enum(["dovepaw", "user-global-prefill", "empty"]),
});

const postResponseSchema = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
  port: z.number().optional(),
  error: z.string().optional(),
});

type Config = z.infer<typeof configShape>;

const EMPTY: Config = {
  embedding: { dense: {} },
  storage: {},
  vlm: {},
};

export function OpenVikingTab() {
  const [config, setConfig] = React.useState<Config>(EMPTY);
  const [source, setSource] = React.useState<
    "dovepaw" | "user-global-prefill" | "empty" | "loading"
  >("loading");
  const [saving, setSaving] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/openviking/config");
        const parsed = getResponseSchema.parse(await res.json());
        setSource(parsed.source);
        if (parsed.config) setConfig(parsed.config);
      } catch {
        setSource("empty");
      }
    })();
  }, []);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/openviking/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const body = postResponseSchema.parse(await res.json());
      if (!res.ok || body.ok !== true) {
        setErrorMessage(body.error ?? "Save failed");
      } else if (body.status === "running") {
        setSuccessMessage(`Saved. Sidecar running on :${body.port}.`);
        setSource("dovepaw");
      } else {
        setErrorMessage(`Saved, but sidecar did not start: ${body.error ?? "unknown error"}`);
        setSource("dovepaw");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dense = config.embedding.dense;
  const vlm = config.vlm;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h2 className="text-2xl font-bold text-accent-foreground">OpenViking</h2>
      <SourceBanner source={source} />

      <Section title="Dense embedding">
        <Field
          label="Provider"
          value={dense.provider ?? ""}
          onChange={(v) =>
            setConfig({
              ...config,
              embedding: { ...config.embedding, dense: { ...dense, provider: v } },
            })
          }
          placeholder="openai | voyage | jina | ollama | gemini | local"
        />
        <Field
          label="Model"
          value={dense.model ?? ""}
          onChange={(v) =>
            setConfig({
              ...config,
              embedding: { ...config.embedding, dense: { ...dense, model: v } },
            })
          }
          placeholder="text-embedding-3-small"
        />
        <Field
          label="API key"
          value={dense.api_key ?? ""}
          secret
          onChange={(v) =>
            setConfig({
              ...config,
              embedding: { ...config.embedding, dense: { ...dense, api_key: v } },
            })
          }
        />
        <Field
          label="API base"
          value={dense.api_base ?? ""}
          onChange={(v) =>
            setConfig({
              ...config,
              embedding: { ...config.embedding, dense: { ...dense, api_base: v } },
            })
          }
          placeholder="https://api.openai.com/v1"
        />
        <NumberField
          label="Dimension"
          value={dense.dimension}
          onChange={(v) =>
            setConfig({
              ...config,
              embedding: { ...config.embedding, dense: { ...dense, dimension: v } },
            })
          }
          placeholder="1536"
        />
      </Section>

      <Section title="Storage">
        <Field
          label="Workspace path"
          value={config.storage.workspace ?? ""}
          onChange={(v) => setConfig({ ...config, storage: { ...config.storage, workspace: v } })}
          placeholder="~/.dovepaw/openviking/data"
        />
      </Section>

      <Section title="VLM">
        <Field
          label="Provider"
          value={vlm.provider ?? ""}
          onChange={(v) => setConfig({ ...config, vlm: { ...vlm, provider: v } })}
          placeholder="openai-codex | openai"
        />
        <Field
          label="Model"
          value={vlm.model ?? ""}
          onChange={(v) => setConfig({ ...config, vlm: { ...vlm, model: v } })}
        />
        <Field
          label="API base"
          value={vlm.api_base ?? ""}
          onChange={(v) => setConfig({ ...config, vlm: { ...vlm, api_base: v } })}
        />
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : "Save & reboot sidecar"}
        </Button>
        {successMessage && <span className="text-sm text-muted-foreground">{successMessage}</span>}
      </div>

      <Dialog open={errorMessage !== null} onOpenChange={(open) => !open && setErrorMessage(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>OpenViking save failed</DialogTitle>
            <DialogDescription>
              Your configuration was written to <code>~/.dovepaw/openviking/ov.conf</code>, but the
              sidecar did not start cleanly. Memory will fall back to <code>.md</code> moments until
              you fix the underlying issue and try again.
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-md border border-border/40 bg-muted px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
            {errorMessage}
          </pre>
          <DialogFooter>
            <Button onClick={() => setErrorMessage(null)}>Dismiss</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourceBanner({
  source,
}: {
  source: "dovepaw" | "user-global-prefill" | "empty" | "loading";
}) {
  if (source === "loading") return null;
  if (source === "dovepaw") {
    return (
      <p className="text-xs text-muted-foreground">
        Editing <code>~/.dovepaw/openviking/ov.conf</code>.
      </p>
    );
  }
  if (source === "user-global-prefill") {
    return (
      <p className="text-xs text-muted-foreground">
        Prefilled from <code>~/.openviking/ov.conf</code>. Save to copy into the DovePaw-scoped
        config.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      No config yet. Fill in the embedding provider at minimum, then save.
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <Input
        type={secret ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <Input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : Number(v));
        }}
      />
    </div>
  );
}
