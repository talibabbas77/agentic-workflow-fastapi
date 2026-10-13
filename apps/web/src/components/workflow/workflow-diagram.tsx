import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { WorkflowRoot } from "./workflow-root";

export type NodeState = "idle" | "done" | "todo" | "current" | "locked";
export type EdgeState = "idle" | "done" | "active" | "locked";
export type Point = { x: number; y: number };

export type WorkflowLayout = {
  width: number;
  height: number;
  /** Where labels sit relative to the tile. */
  labels: "right" | "below";
  /** Label width in design units. */
  labelWidth?: number;
  nodes: Record<string, Point>;
  /** SVG path data per edge id, in the same design units. */
  edges: Record<string, string>;
};

export type WorkflowNodeSpec = {
  id: string;
  title: string;
  detail?: string;
  icon: ReactNode;
  state?: NodeState;
  /** Small corner badge, for example a lock on steps that are not available yet. */
  badge?: ReactNode;
  /** Native tooltip text. */
  tooltip?: string;
  /** Status read by screen readers after the title. */
  status?: string;
  /** Position in the looping walkthrough. */
  beat?: number;
  /**
   * Render the node body as an interactive element. Receives the body content
   * and the class name the element must carry.
   */
  render?: (content: ReactNode, className: string) => ReactNode;
};

export type WorkflowEdgeSpec = {
  id: string;
  state?: EdgeState;
  /** Beat of the node this edge leads into, for the looping walkthrough. */
  beat?: number;
};

type WorkflowDiagramProps = {
  label: string;
  nodes: WorkflowNodeSpec[];
  edges: WorkflowEdgeSpec[];
  narrow: WorkflowLayout;
  wide?: WorkflowLayout;
  /** Light up each node in turn on a loop instead of showing static states. */
  loop?: boolean;
  className?: string;
};

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * Smooth orthogonal path through a list of points, with rounded corners.
 * Every edge in a diagram is built from this or a straight line.
 */
export function route(points: Point[], radius = 12): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M${first!.x} ${first!.y}`;
  for (let i = 0; i < rest.length; i++) {
    const corner = rest[i]!;
    const next = rest[i + 1];
    if (!next) {
      d += ` L${corner.x} ${corner.y}`;
      break;
    }
    const prev = i === 0 ? first! : rest[i - 1]!;
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = corner.x - ((corner.x - prev.x) / inLen) * r;
    const ay = corner.y - ((corner.y - prev.y) / inLen) * r;
    const bx = corner.x + ((next.x - corner.x) / outLen) * r;
    const by = corner.y + ((next.y - corner.y) / outLen) * r;
    d += ` L${round(ax)} ${round(ay)} Q${corner.x} ${corner.y} ${round(bx)} ${round(by)}`;
  }
  return d;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function EdgeLayer({
  layout,
  edges,
  name,
  loop,
}: {
  layout: WorkflowLayout;
  edges: WorkflowEdgeSpec[];
  name: "wide" | "narrow";
  loop: boolean;
}) {
  return (
    <svg
      className="wf-edges"
      data-layout={name}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {edges.map((edge) => {
        const d = layout.edges[edge.id];
        if (!d) return null;
        const state = edge.state ?? "idle";
        const moving = loop || state === "active";
        return (
          <g
            key={edge.id}
            className="wf-edge"
            data-state={state}
            style={{ "--beat": edge.beat ?? 0 } as Vars}
          >
            <path className="wf-edge-base" d={d} />
            {moving ? <path className="wf-edge-flow" d={d} /> : null}
            {moving ? <path className="wf-edge-dot" d={d} pathLength={100} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A small flow chart: rounded-square tiles with an icon and a label, joined by
 * smooth edges. Pure server-rendered markup and CSS; the only script is a tiny
 * observer that pauses the motion while the diagram is off screen.
 */
export function WorkflowDiagram({
  label,
  nodes,
  edges,
  narrow,
  wide = narrow,
  loop = false,
  className,
}: WorkflowDiagramProps) {
  const stageVars: Vars = {
    "--nw": narrow.width,
    "--nh": narrow.height,
    "--ww": wide.width,
    "--wh": wide.height,
  };

  return (
    <WorkflowRoot label={label} loop={loop} className={cn("wf", className)}>
      <div
        className="wf-stage"
        data-narrow-labels={narrow.labels}
        data-wide-labels={wide.labels}
        style={stageVars}
      >
        <EdgeLayer layout={narrow} edges={edges} name="narrow" loop={loop} />
        {wide !== narrow ? <EdgeLayer layout={wide} edges={edges} name="wide" loop={loop} /> : null}
        <ol className="wf-nodes">
          {nodes.map((node, index) => {
            const n = narrow.nodes[node.id] ?? { x: 0, y: 0 };
            const w = wide.nodes[node.id] ?? n;
            const vars: Vars = {
              "--nx": n.x,
              "--ny": n.y,
              "--wx": w.x,
              "--wy": w.y,
              "--nlw": narrow.labelWidth ?? 200,
              "--wlw": wide.labelWidth ?? 200,
              "--i": index,
              "--beat": node.beat ?? index,
            };
            const content = (
              <>
                <span className="wf-tile" aria-hidden="true">
                  {node.icon}
                  {node.badge ? <span className="wf-badge">{node.badge}</span> : null}
                </span>
                <span className="wf-label">
                  <span className="wf-title">{node.title}</span>
                  {node.detail ? <span className="wf-detail">{node.detail}</span> : null}
                  {node.status ? <span className="sr-only">. {node.status}</span> : null}
                </span>
              </>
            );
            return (
              <li
                key={node.id}
                className="wf-node"
                data-state={node.state ?? "idle"}
                title={node.tooltip}
                style={vars}
              >
                {node.render ? node.render(content, "wf-body") : <div className="wf-body">{content}</div>}
              </li>
            );
          })}
        </ol>
      </div>
    </WorkflowRoot>
  );
}
