import type { EdgeProps, InternalNode, Node } from "@xyflow/react";
import {
  BaseEdge,
  getBezierPath,
  getSimpleBezierPath,
  Position,
  useInternalNode,
} from "@xyflow/react";

const Temporary = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) => {
  const [edgePath] = getSimpleBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });

  return (
    <BaseEdge
      className="stroke-1 stroke-ring"
      id={id}
      path={edgePath}
      style={{ strokeDasharray: "5, 5" }}
    />
  );
};

const getHandleCoordsByPosition = (node: InternalNode<Node>, handlePosition: Position) => {
  const handleType =
    handlePosition === Position.Left || handlePosition === Position.Top ? "target" : "source";
  const handle = node.internals.handleBounds?.[handleType]?.find(
    (h) => h.position === handlePosition,
  );
  if (!handle) return [0, 0] as const;

  let offsetX = handle.width / 2;
  let offsetY = handle.height / 2;
  switch (handlePosition) {
    case Position.Left:
      offsetX = 0;
      break;
    case Position.Right:
      offsetX = handle.width;
      break;
    case Position.Top:
      offsetY = 0;
      break;
    case Position.Bottom:
      offsetY = handle.height;
      break;
  }
  return [
    node.internals.positionAbsolute.x + handle.x + offsetX,
    node.internals.positionAbsolute.y + handle.y + offsetY,
  ] as const;
};

const getEdgeParams = (source: InternalNode<Node>, target: InternalNode<Node>) => {
  const sourcePos = Position.Bottom;
  const [sx, sy] = getHandleCoordsByPosition(source, sourcePos);
  const targetPos = Position.Top;
  const [tx, ty] = getHandleCoordsByPosition(target, targetPos);
  return { sourcePos, sx, sy, targetPos, tx, ty };
};

const Animated = ({ id, source, target, markerEnd, style }: EdgeProps) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!(sourceNode && targetNode)) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);
  const [edgePath] = getBezierPath({
    sourcePosition: sourcePos,
    sourceX: sx,
    sourceY: sy,
    targetPosition: targetPos,
    targetX: tx,
    targetY: ty,
  });

  const gradientId = `edge-gradient-${id}`;
  const glowId = `edge-glow-${id}`;

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sx}
          y1={sy}
          x2={tx}
          y2={ty}
        >
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
          <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.2" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Glow layer */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3"
        strokeOpacity="0.15"
        filter={`url(#${glowId})`}
      />
      {/* Main edge */}
      <path
        d={edgePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.5"
        style={style}
      />
      {/* Travelling particle */}
      <circle r="3" fill="var(--primary)" filter={`url(#${glowId})`}>
        <animateMotion dur="1.5s" path={edgePath} repeatCount="indefinite" />
      </circle>
    </>
  );
};

export const Edge = { Animated, Temporary };
