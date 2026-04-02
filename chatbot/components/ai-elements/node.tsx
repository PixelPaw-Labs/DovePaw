import { cn } from "@/lib/utils";
import { Handle, Position } from "@xyflow/react";
import type { ComponentProps } from "react";

export type NodeProps = ComponentProps<"div"> & {
  handles: { target: boolean; source: boolean };
};

export const Node = ({ handles, className, ...props }: NodeProps) => (
  <div
    className={cn(
      "node-container relative h-auto w-64 rounded-md border bg-card shadow-sm",
      className,
    )}
    {...props}
  >
    {handles.target && <Handle position={Position.Top} type="target" />}
    {handles.source && <Handle position={Position.Bottom} type="source" />}
    {props.children}
  </div>
);

export type NodeHeaderProps = ComponentProps<"div">;
export const NodeHeader = ({ className, ...props }: NodeHeaderProps) => (
  <div className={cn("gap-0.5 rounded-t-md border-b bg-muted/50 p-3", className)} {...props} />
);

export type NodeTitleProps = ComponentProps<"p">;
export const NodeTitle = ({ className, ...props }: NodeTitleProps) => (
  <p className={cn("text-sm font-semibold leading-snug break-all", className)} {...props} />
);

export type NodeDescriptionProps = ComponentProps<"p">;
export const NodeDescription = ({ className, ...props }: NodeDescriptionProps) => (
  <p className={cn("text-xs text-muted-foreground", className)} {...props} />
);

export type NodeContentProps = ComponentProps<"div">;
export const NodeContent = ({ className, ...props }: NodeContentProps) => (
  <div className={cn("p-3", className)} {...props} />
);

export type NodeFooterProps = ComponentProps<"div">;
export const NodeFooter = ({ className, ...props }: NodeFooterProps) => (
  <div className={cn("rounded-b-md border-t bg-muted/50 p-3", className)} {...props} />
);
