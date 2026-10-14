/*
 * Radial layout for the memory map, in SVG units. Pure and deterministic: the
 * same data always gives the same picture, so nothing jumps between renders.
 *
 * The agent sits at the center. Each branch has a hub on an inner ellipse in a
 * fixed direction, and its leaves sit on an outer ellipse, fanned around that
 * direction with the most important leaf in the middle.
 */

export type BranchId = "knowledge" | "answers" | "customers" | "gaps";

export const BRANCHES: readonly BranchId[] = ["knowledge", "answers", "customers", "gaps"];

export type LeafInput = {
  id: string;
  /** Sets the size: passages, citations, facts, or times asked. */
  weight: number;
  /** Sets the edge width, such as citations in 30 days, on a log scale so one citation stays thin. */
  strength: number;
};

export type BranchInput = {
  id: BranchId;
  label: string;
  /** Shown in the hub after the label. */
  count: number;
  /** Most important first. */
  leaves: LeafInput[];
};

export type Point = { x: number; y: number };
export type Hub = Point & { branch: BranchId; width: number; height: number; label: string; count: string };
export type Leaf = Point & { id: string; branch: BranchId; r: number };
export type Edge = { id: string; branch: BranchId; d: string; width: number; trunk: boolean };
export type More = Point & { branch: BranchId; text: string };

export type MapLayout = {
  width: number;
  height: number;
  center: Point & { r: number };
  hubs: Hub[];
  leaves: Leaf[];
  edges: Edge[];
  more: More[];
  /** Hub pills show their label; on narrow maps only the icon and count. */
  labels: boolean;
};

type Geometry = {
  width: number;
  height: number;
  centerR: number;
  hub: { rx: number; ry: number };
  leaf: { rx: number; ry: number };
  /** Half the fan, in degrees. */
  spread: Record<BranchId, number>;
  /** Widest angle between two leaves, in degrees, so a few leaves stay together. */
  step: number;
  maxLeaves: Record<BranchId, number>;
  leafR: Record<BranchId, readonly [number, number]>;
  labels: boolean;
};

/** Knowledge gets the left, where a wide map has the most room; the rest take the other sides. */
const DIRECTION: Record<BranchId, number> = { knowledge: 180, answers: 270, customers: 0, gaps: 90 };

const SIZES = { knowledge: [3.5, 8.5], answers: [3.5, 8], customers: [3.5, 8], gaps: [3.5, 8.5] } as const;

export const GEOMETRY: Record<"wide" | "narrow", Geometry> = {
  wide: {
    width: 760,
    height: 500,
    centerR: 30,
    hub: { rx: 160, ry: 112 },
    leaf: { rx: 312, ry: 206 },
    spread: { knowledge: 46, answers: 30, customers: 32, gaps: 30 },
    step: 11,
    maxLeaves: { knowledge: 12, answers: 9, customers: 8, gaps: 9 },
    leafR: SIZES,
    labels: true,
  },
  narrow: {
    width: 360,
    height: 440,
    centerR: 26,
    hub: { rx: 94, ry: 112 },
    leaf: { rx: 154, ry: 186 },
    spread: { knowledge: 40, answers: 32, customers: 40, gaps: 32 },
    step: 13,
    maxLeaves: { knowledge: 9, answers: 6, customers: 6, gaps: 6 },
    leafR: SIZES,
    labels: false,
  },
};

const PILL_HEIGHT = 30;
/** A generous glyph width at the pill's font size, for sizing pills without measuring text. */
const GLYPH = 7.4;

const DEG = Math.PI / 180;
const round = (n: number) => Math.round(n * 10) / 10;

export function layoutMap(branches: BranchInput[], variant: "wide" | "narrow"): MapLayout {
  const g = GEOMETRY[variant];
  const cx = g.width / 2;
  const cy = g.height / 2;
  const at = (radius: { rx: number; ry: number }, degrees: number, scale = 1): Point => ({
    x: round(cx + radius.rx * scale * Math.cos(degrees * DEG)),
    y: round(cy + radius.ry * scale * Math.sin(degrees * DEG)),
  });

  const hubs: Hub[] = [];
  const leaves: Leaf[] = [];
  const edges: Edge[] = [];
  const more: More[] = [];

  for (const branch of branches) {
    const direction = DIRECTION[branch.id];
    const hub = at(g.hub, direction);
    const count = branch.count.toLocaleString("en-US");
    const text = (g.labels ? branch.label.length + 1.5 : 0) + count.length;
    hubs.push({
      ...hub,
      branch: branch.id,
      width: Math.round(46 + text * GLYPH),
      height: PILL_HEIGHT,
      label: branch.label,
      count,
    });
    edges.push({ id: `trunk-${branch.id}`, branch: branch.id, d: `M${cx} ${cy} L${hub.x} ${hub.y}`, width: 1, trunk: true });

    const shown = branch.leaves.slice(0, g.maxLeaves[branch.id]);
    if (shown.length === 0) continue;
    const step = shown.length > 1 ? Math.min(g.step, (2 * g.spread[branch.id]) / (shown.length - 1)) : 0;
    const offsets = middleOut(shown.length).map((slot) => slot * step);
    const [minR, maxR] = g.leafR[branch.id];
    const heaviest = Math.max(1, ...shown.map((leaf) => leaf.weight));

    shown.forEach((leaf, index) => {
      const angle = direction + offsets[index]!;
      const point = at(g.leaf, angle);
      // Twigs leave the hub along the branch, then bend toward their leaf.
      const bend = at(g.hub, direction + offsets[index]! * 0.35, 1.32);
      leaves.push({
        ...point,
        id: leaf.id,
        branch: branch.id,
        r: round(minR + (maxR - minR) * Math.sqrt(leaf.weight / heaviest)),
      });
      edges.push({
        id: `twig-${leaf.id}`,
        branch: branch.id,
        d: `M${hub.x} ${hub.y} Q${bend.x} ${bend.y} ${point.x} ${point.y}`,
        width: round(1 + Math.min(2.5, 0.8 * Math.log2(1 + leaf.strength))),
        trunk: false,
      });
    });

    const hidden = branch.leaves.length - shown.length;
    if (hidden > 0) {
      const last = Math.max(...offsets);
      more.push({ ...at(g.leaf, direction + last + Math.max(step, 9)), branch: branch.id, text: `+${hidden}` });
    }
  }

  return {
    width: g.width,
    height: g.height,
    center: { x: cx, y: cy, r: g.centerR },
    hubs,
    leaves,
    edges,
    more,
    labels: g.labels,
  };
}

/** Slots for n items, first item in the middle, then alternating outward: 0, 1, -1, 2, -2... */
function middleOut(n: number): number[] {
  const mid = (n - 1) / 2;
  const slots = Array.from({ length: n }, (_, i) => i - mid);
  return slots.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
}
