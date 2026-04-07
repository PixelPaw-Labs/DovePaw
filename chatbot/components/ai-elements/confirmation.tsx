"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

// ─── Context ──────────────────────────────────────────────────────────────────

type ConfirmationState = "pending" | "approved" | "denied";

// ─── Root ─────────────────────────────────────────────────────────────────────

export type ConfirmationProps = ComponentProps<"div"> & {
  state: ConfirmationState;
};

export const Confirmation = ({ className, state, ...props }: ConfirmationProps) => (
  <div
    className={cn(
      "rounded-lg border px-4 py-3 flex items-start gap-3",
      state === "pending" && "border-amber-500/40 bg-amber-500/5",
      state === "approved" && "border-green-500/40 bg-green-500/5",
      state === "denied" && "border-muted bg-muted/20",
      className,
    )}
    data-state={state}
    {...props}
  />
);

// ─── Icon ─────────────────────────────────────────────────────────────────────

export const ConfirmationIcon = ({ state }: { state: ConfirmationState }) => {
  if (state === "approved")
    return <ShieldCheck className="mt-0.5 size-4 text-green-500 shrink-0" />;
  if (state === "denied")
    return <ShieldX className="mt-0.5 size-4 text-muted-foreground shrink-0" />;
  return <ShieldAlert className="mt-0.5 size-4 text-amber-500 shrink-0" />;
};

// ─── Body ─────────────────────────────────────────────────────────────────────

export const ConfirmationBody = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("flex-1 min-w-0 space-y-2", className)} {...props} />
);

// ─── Title ────────────────────────────────────────────────────────────────────

export const ConfirmationTitle = ({ className, ...props }: ComponentProps<"p">) => (
  <p className={cn("text-sm font-medium leading-none", className)} {...props} />
);

// ─── Request (shown while pending) ───────────────────────────────────────────

export const ConfirmationRequest = ({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children?: ReactNode }) => (
  <div className={cn("text-xs text-muted-foreground", className)} {...props}>
    {children}
  </div>
);

// ─── Accepted / Rejected status lines ────────────────────────────────────────

export const ConfirmationAccepted = ({ className, ...props }: ComponentProps<"p">) => (
  <p className={cn("text-xs text-green-600 dark:text-green-400", className)} {...props} />
);

export const ConfirmationRejected = ({ className, ...props }: ComponentProps<"p">) => (
  <p className={cn("text-xs text-muted-foreground", className)} {...props} />
);

// ─── Actions ─────────────────────────────────────────────────────────────────

export const ConfirmationActions = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("flex items-center gap-2 pt-1", className)} {...props} />
);

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = ({ className, ...props }: ConfirmationActionProps) => (
  <Button className={cn("h-7 px-3 text-xs", className)} {...props} />
);
