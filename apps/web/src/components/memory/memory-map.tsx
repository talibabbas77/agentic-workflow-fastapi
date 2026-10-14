"use client";

import type { GapGroup, MemoryOverview, RememberedCustomer, Source, TeamAnswer } from "@docent/api-client";
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { audienceLabel, kindLabel } from "@/components/knowledge/source-meta";
import { formatCount, formatRelative, plural } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { BRANCHES, layoutMap, type BranchId, type BranchInput, type MapLayout } from "./map-layout";
import { answerStatusLabel, branchIcon, branchLabel } from "./memory-meta";

/** What a node says about itself: its name, a few facts, and what selecting it does. */
type NodeInfo = { id: string; branch: BranchId; leaf: string | null; name: string; lines: string[]; action: string };

const hubId = (branch: BranchId) => `hub-${branch}`;
const count = (n: number, singular: string, pluralForm?: string) =>
  `${formatCount(n)} ${plural(n, singular, pluralForm)}`;
const cited = (n: number) => (n === 0 ? "Not cited in the last 30 days" : `Cited ${count(n, "time")} in the last 30 days`);

type MapData = {
  overview: MemoryOverview;
  answers: TeamAnswer[];
  gaps: GapGroup[];
  customers: RememberedCustomer[];
};

function describe({ overview, answers, gaps, customers }: MapData, now: number | null) {
  const sources = overview.sources;
  const passages = sources.reduce((sum, s) => sum + s.chunks, 0);
  const sourceCites = sources.reduce((sum, s) => sum + s.citations_30d, 0);
  const answerCites = answers.reduce((sum, a) => sum + a.citations_30d, 0);
  const byCitations = [...answers].sort((a, b) => b.citations_30d - a.citations_30d);

  const inputs: BranchInput[] = [
    {
      id: "knowledge",
      label: branchLabel.knowledge,
      count: sources.length,
      leaves: sources.map((s) => ({ id: s.id, weight: s.chunks, strength: s.citations_30d })),
    },
    {
      id: "answers",
      label: branchLabel.answers,
      count: overview.team_answers,
      leaves: byCitations.map((a) => ({ id: a.id, weight: a.citations_30d, strength: a.citations_30d })),
    },
    {
      id: "customers",
      label: branchLabel.customers,
      count: overview.customers_remembered,
      leaves: customers.map((c) => ({ id: c.id, weight: c.facts, strength: 0 })),
    },
    {
      id: "gaps",
      label: branchLabel.gaps,
      count: overview.open_gaps,
      leaves: gaps.map((g) => ({ id: g.ids[0]!, weight: g.count, strength: 0 })),
    },
  ];

  const nodes: NodeInfo[] = [
    {
      id: hubId("knowledge"),
      branch: "knowledge",
      leaf: null,
      name: `Knowledge: ${count(sources.length, "source")}`,
      lines: [count(passages, "passage"), `${count(sourceCites, "citation")} in the last 30 days`],
      action: "Select to see the most cited sections.",
    },
    ...sources.map((s) => ({
      id: s.id,
      branch: "knowledge" as const,
      leaf: s.id,
      name: s.title,
      lines: [
        `${kindLabel[s.kind as Source["kind"]] ?? "Source"}, ${count(s.chunks, "passage")}`,
        cited(s.citations_30d),
        ...(s.status === "ready" ? [] : [answerStatusLabel(s.status)]),
      ],
      action: "Select to open the source.",
    })),
    {
      id: hubId("answers"),
      branch: "answers",
      leaf: null,
      name: `Team answers: ${formatCount(overview.team_answers)}`,
      lines: ["Written by your team, cited like your articles", `${count(answerCites, "citation")} in the last 30 days`],
      action: "Select to see the team answers.",
    },
    ...byCitations.map((a) => ({
      id: a.id,
      branch: "answers" as const,
      leaf: a.id,
      name: a.question,
      lines: [
        `For ${audienceLabel[a.audience].toLowerCase()}`,
        cited(a.citations_30d),
        ...(a.status === "ready" ? [] : [answerStatusLabel(a.status)]),
      ],
      action: "Select to see the team answers.",
    })),
    {
      id: hubId("customers"),
      branch: "customers",
      leaf: null,
      name: `Customer memory: ${count(overview.customers_remembered, "customer")}`,
      lines: [`${count(overview.customer_facts, "fact")} in all`, "Each fact is kept for 90 days"],
      action: "Select to see the customers.",
    },
    ...customers.map((c) => ({
      id: c.id,
      branch: "customers" as const,
      leaf: c.id,
      name: c.name || c.email || "Signed-in customer",
      lines: [
        count(c.facts, "fact"),
        c.last_seen_at ? `Last seen ${formatRelative(c.last_seen_at, now)}` : "Not seen yet",
      ],
      action: "Select to see the customers.",
    })),
    {
      id: hubId("gaps"),
      branch: "gaps",
      leaf: null,
      name: `Knowledge gaps: ${count(overview.open_gaps, "open question")}`,
      lines: [
        gaps.length === 0 ? "Nothing waiting for an answer" : `${count(gaps.length, "group")} of similar questions`,
        "Questions the agent could not answer from your sources",
      ],
      action: "Select to answer them.",
    },
    ...gaps.map((g) => ({
      id: g.ids[0]!,
      branch: "gaps" as const,
      leaf: g.ids[0]!,
      name: g.question,
      lines: [`Asked ${count(g.count, "time")}`, `Last asked ${formatRelative(g.last_asked_at, now)}`],
      action: "Select to answer it.",
    })),
  ];

  return { inputs, nodes: new Map(nodes.map((node) => [node.id, node])) };
}

/**
 * A radial map of what the agent draws on: the agent in the middle, a branch for
 * each kind of memory, and a leaf for each source, answer, customer, or gap.
 * Every node takes focus (arrow keys move between them) and shows its details;
 * selecting one opens its list below the map.
 */
export function MemoryMap({
  overview,
  answers,
  gaps,
  customers,
  onSelect,
}: MapData & { onSelect: (branch: BranchId, leaf: string | null) => void }) {
  const now = useNow();
  const { inputs, nodes } = useMemo(
    () => describe({ overview, answers, gaps, customers }, now),
    [overview, answers, gaps, customers, now],
  );
  const wide = useMemo(() => layoutMap(inputs, "wide"), [inputs]);
  const narrow = useMemo(() => layoutMap(inputs, "narrow"), [inputs]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [tabStop, setTabStop] = useState(hubId("knowledge"));
  const tipId = useId();
  const shown = hovered ?? focused;
  const info = shown ? nodes.get(shown) : undefined;

  const canvas = { nodes, shown, tipId, tabStop, setHovered, setFocused, setTabStop, onSelect };

  return (
    <div className="@container flex flex-col gap-4">
      {/* Both layouts are drawn; the container's width shows one, so nothing moves after it loads. */}
      <MapCanvas {...canvas} layout={wide} className="hidden @min-[34rem]:block" />
      <MapCanvas {...canvas} layout={narrow} className="@min-[34rem]:hidden" />
      {/* Details sit under the map at a fixed height, so they never cover a node or move the page. */}
      <div className="flex h-[5.5rem] flex-col justify-center rounded-md border border-line bg-paper px-4 py-3 text-sm">
        {info ? (
          <div id={tipId} role="tooltip" className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-medium text-ink">{info.name}</p>
            <p className="line-clamp-2 text-ink-muted">{info.lines.join(". ")}.</p>
            <p className="truncate text-xs text-ink-muted">{info.action}</p>
          </div>
        ) : (
          <p className="text-ink-muted">
            Point at or tab to any part of the map to see what it holds. Arrow keys move between parts.
          </p>
        )}
      </div>
      <div className="sr-only">
        <h3>The memory map as a list</h3>
        <ul>
          {BRANCHES.map((branch) => {
            const hub = nodes.get(hubId(branch))!;
            const leaves = [...nodes.values()].filter((node) => node.branch === branch && node.leaf);
            return (
              <li key={branch}>
                {hub.name}. {hub.lines.join(". ")}.
                {leaves.length > 0 ? (
                  <ul>
                    {leaves.map((leaf) => (
                      <li key={leaf.id}>
                        {leaf.name}. {leaf.lines.join(". ")}.
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

type CanvasProps = {
  layout: MapLayout;
  className: string;
  nodes: Map<string, NodeInfo>;
  /** The node being pointed at or focused, whose details show under the map. */
  shown: string | null;
  tipId: string;
  tabStop: string;
  setHovered: (id: string | null) => void;
  setFocused: (id: string | null) => void;
  setTabStop: (id: string) => void;
  onSelect: (branch: BranchId, leaf: string | null) => void;
};

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function MapCanvas({
  layout,
  className,
  nodes,
  shown,
  tipId,
  tabStop,
  setHovered,
  setFocused,
  setTabStop,
  onSelect,
}: CanvasProps) {
  const refs = useRef(new Map<string, SVGGElement>());

  // Keyboard order: each hub, then its leaves, branch by branch.
  const order = BRANCHES.flatMap((branch) => [
    hubId(branch),
    ...layout.leaves.filter((leaf) => leaf.branch === branch).map((leaf) => leaf.id),
  ]);
  const stop = order.includes(tabStop) ? tabStop : order[0]!;
  const activeBranch = (shown && nodes.get(shown)?.branch) || null;

  function onKeyDown(event: KeyboardEvent<SVGGElement>, id: string) {
    const index = order.indexOf(id);
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % order.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const node = nodes.get(id);
      if (node) onSelect(node.branch, node.leaf);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    refs.current.get(order[next]!)?.focus();
  }

  const nodeProps = (id: string, branch: BranchId, index: number) => {
    const node = nodes.get(id);
    return {
      ref: (el: SVGGElement | null) => {
        if (el) refs.current.set(id, el);
        else refs.current.delete(id);
      },
      role: "button",
      tabIndex: id === stop ? 0 : -1,
      "aria-label": node?.name,
      "aria-describedby": shown === id ? tipId : undefined,
      "data-branch": branch,
      "data-lit": shown === id || undefined,
      "data-dim": (activeBranch && activeBranch !== branch) || undefined,
      className: "mm-node",
      style: { "--i": index } as Vars,
      onPointerEnter: () => setHovered(id),
      onPointerLeave: () => setHovered(null),
      onFocus: () => {
        setFocused(id);
        setTabStop(id);
      },
      onBlur: () => setFocused(null),
      onClick: () => node && onSelect(node.branch, node.leaf),
      onKeyDown: (event: KeyboardEvent<SVGGElement>) => onKeyDown(event, id),
    };
  };

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="mm"
        role="group"
        aria-label="Memory map. Arrow keys move between parts; Enter opens one."
      >
        <g aria-hidden="true">
          {layout.edges.map((edge, index) => (
            <path
              key={edge.id}
              d={edge.d}
              className="mm-edge"
              strokeWidth={edge.width}
              data-branch={edge.branch}
              data-trunk={edge.trunk || undefined}
              data-lit={(activeBranch === edge.branch && (edge.trunk || edge.id === `twig-${shown}`)) || undefined}
              data-dim={(activeBranch && activeBranch !== edge.branch) || undefined}
              style={{ "--i": index } as Vars}
            />
          ))}
          {layout.edges
            .filter((edge) => edge.trunk && edge.branch !== "gaps")
            .filter((edge) => layout.leaves.some((leaf) => leaf.branch === edge.branch))
            .map((edge, index) => (
              <path
                key={`flow-${edge.id}`}
                d={edge.d}
                pathLength={100}
                className="mm-flow"
                style={{ "--i": index } as Vars}
              />
            ))}
          {layout.more.map((more) => (
            <text
              key={`more-${more.branch}`}
              x={more.x}
              y={more.y}
              dy="0.35em"
              textAnchor="middle"
              className="mm-more"
              data-dim={(activeBranch && activeBranch !== more.branch) || undefined}
            >
              {more.text}
            </text>
          ))}
        </g>

        <g aria-hidden="true">
          <circle cx={layout.center.x} cy={layout.center.y} r={layout.center.r + 7} className="mm-ring" />
          <circle cx={layout.center.x} cy={layout.center.y} r={layout.center.r} className="mm-halo" />
          <circle cx={layout.center.x} cy={layout.center.y} r={layout.center.r} className="mm-core" />
          <text x={layout.center.x} y={layout.center.y} dy="0.35em" textAnchor="middle" className="mm-core-text">
            Agent
          </text>
        </g>

        {layout.hubs.map((hub, index) => {
          const Icon = branchIcon[hub.branch];
          const x = hub.x - hub.width / 2;
          const y = hub.y - hub.height / 2;
          return (
            <g
              key={hub.branch}
              {...nodeProps(hubId(hub.branch), hub.branch, index + 1)}
              className="mm-node mm-hub"
              data-empty={hub.count === "0" || undefined}
            >
              <rect
                x={x - 4}
                y={y - 4}
                width={hub.width + 8}
                height={hub.height + 8}
                rx={(hub.height + 8) / 2}
                className="mm-focus"
              />
              <rect x={x} y={y} width={hub.width} height={hub.height} rx={hub.height / 2} className="mm-pill" />
              <Icon
                aria-hidden="true"
                x={x + 12}
                y={hub.y - 8}
                width={16}
                height={16}
                className="mm-icon"
              />
              {layout.labels ? (
                <text x={x + 34} y={hub.y} dy="0.35em" className="mm-label">
                  {hub.label}
                </text>
              ) : null}
              <text x={x + hub.width - 12} y={hub.y} dy="0.35em" textAnchor="end" className="mm-count">
                {hub.count}
              </text>
            </g>
          );
        })}

        {layout.leaves.map((leaf, index) => (
          <g key={leaf.id} {...nodeProps(leaf.id, leaf.branch, index + 5)}>
            <circle cx={leaf.x} cy={leaf.y} r={Math.max(leaf.r, 10)} className="mm-hit" />
            <circle cx={leaf.x} cy={leaf.y} r={leaf.r + 4} className="mm-focus" />
            <circle cx={leaf.x} cy={leaf.y} r={leaf.r} className="mm-leaf" data-branch={leaf.branch} />
          </g>
        ))}
      </svg>
    </div>
  );
}
