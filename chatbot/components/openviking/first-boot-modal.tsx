"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DISMISS_KEY = "openviking-first-boot-dismissed";
const responseShape = z.object({ sidecarRunning: z.boolean().optional() });

export function OpenVikingFirstBootModal() {
  const router = useRouter();
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/openviking/config");
        if (!res.ok) return;
        const parsed = responseShape.safeParse(await res.json());
        if (cancelled || !parsed.success) return;
        // Trigger on sidecar liveness, not config-file presence. An auto-
        // generated ov.conf can exist while the sidecar is down because
        // llama-cpp / embedder isn't configured — that's exactly the case
        // this modal exists to nudge the user toward Settings for.
        if (parsed.data.sidecarRunning !== true) setShow(true);
      } catch {
        // network/server hiccup — don't pester
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (remember: boolean): void => {
    if (remember) localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  const configureNow = (): void => {
    dismiss(true);
    router.push("/settings?tab=memory");
  };

  return (
    <Dialog open={show} onOpenChange={(next) => (next ? setShow(true) : dismiss(false))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configure OpenViking memory</DialogTitle>
          <DialogDescription>
            DovePaw can store group-chat moments in OpenViking for semantic recall across tasks.
            Without it, members write plain <code>.md</code> files instead.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          One-time setup: pick an embedding provider (OpenAI, voyage, ollama, …) and save. You can
          prefill from your existing <code>~/.openviking/ov.conf</code> if you have one.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dismiss(true)}>
            Don't ask again
          </Button>
          <Button variant="outline" onClick={() => dismiss(false)}>
            Not now
          </Button>
          <Button onClick={configureNow}>Configure</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
