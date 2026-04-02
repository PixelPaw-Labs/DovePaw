import { cn } from "@/lib/utils";
import { Handle, Position } from "@xyflow/react";
import type { ComponentProps } from "react";

export type NodeProps = ComponentProps<"div"> & {
  handles: { target: boolean; source: boolean };
};

export const Node = ({ handles, className, ...props }: NodeProps) => (
  <div
    className={cn(
      "node-container relative h-auto w-64 rounded-xl border border-white/10",
      "bg-card/80 backdrop-blur-md",
      "shadow-[0_8px_32px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)]",
      "transition-shadow duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.5),0_4px_12px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12)]",
      className,
    )}
    {...props}
  >
    {handles.target && (
      <Handle
        position={Position.Top}
        type="target"
        className="!bg-primary/80 !border-primary/40 !w-2.5 !h-2.5 !shadow-[0_0_6px_rgba(var(--primary),0.6)]"
      />
    )}
    {handles.source && (
      <Handle
        position={Position.Bottom}
        type="source"
        className="!bg-primary/80 !border-primary/40 !w-2.5 !h-2.5 !shadow-[0_0_6px_rgba(var(--primary),0.6)]"
      />
    )}
    {props.children}
  </div>
);

export type NodeHeaderProps = ComponentProps<"div">;
export const NodeHeader = ({ className, ...props }: NodeHeaderProps) => (
  <div
    className={cn(
      "gap-0.5 rounded-t-xl border-b border-white/8 p-3",
      "bg-gradient-to-b from-white/6 to-transparent",
      className,
    )}
    {...props}
  />
);

export type NodeTitleProps = ComponentProps<"p">;
export const NodeTitle = ({ className, ...props }: NodeTitleProps) => (
  <p
    className={cn(
      "text-sm font-semibold leading-snug break-all",
      "bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent",
      className,
    )}
    {...props}
  />
);

export type NodeDescriptionProps = ComponentProps<"p">;
export const NodeDescription = ({ className, ...props }: NodeDescriptionProps) => (
  <p className={cn("text-xs text-muted-foreground/70 mt-0.5", className)} {...props} />
);

export type NodeContentProps = ComponentProps<"div">;
export const NodeContent = ({ className, ...props }: NodeContentProps) => (
  <div className={cn("p-3", className)} {...props} />
);

export type NodeFooterProps = ComponentProps<"div">;
export const NodeFooter = ({ className, ...props }: NodeFooterProps) => (
  <div
    className={cn(
      "rounded-b-xl border-t border-white/8 p-3",
      "bg-gradient-to-t from-white/4 to-transparent",
      className,
    )}
    {...props}
  />
);
