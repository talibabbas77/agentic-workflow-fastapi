import {
  ChatCircleTextIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  RowsIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { route, WorkflowDiagram, type WorkflowLayout } from "@/components/workflow/workflow-diagram";

/* "How teaching works": what happens to a source from upload to answers. */

const steps = [
  { id: "add", icon: <UploadSimpleIcon />, title: "Add a source", detail: "Files, a page, or a sitemap" },
  { id: "read", icon: <FileTextIcon />, title: "Docent reads it", detail: "Text from PDF, Word, and web pages" },
  { id: "split", icon: <RowsIcon />, title: "Splits it into passages", detail: "Short sections under their headings" },
  { id: "index", icon: <MagnifyingGlassIcon />, title: "Indexes for search", detail: "By meaning and by keyword" },
  { id: "ready", icon: <ChatCircleTextIcon />, title: "Ready to answer", detail: "Citing the passage it used" },
];

const NARROW_PITCH = 64;
const WIDE_PITCH = 168;

const narrow: WorkflowLayout = {
  width: 320,
  height: 40 + NARROW_PITCH * (steps.length - 1),
  labelWidth: 260,
  nodes: Object.fromEntries(steps.map((s, i) => [s.id, { x: 20, y: 20 + i * NARROW_PITCH }])),
  edges: Object.fromEntries(
    steps.slice(1).map((s, i) => [
      s.id,
      route([
        { x: 20, y: 20 + i * NARROW_PITCH },
        { x: 20, y: 20 + (i + 1) * NARROW_PITCH },
      ]),
    ]),
  ),
};

const wide: WorkflowLayout = {
  width: WIDE_PITCH * steps.length,
  height: 112,
  labelWidth: 148,
  nodes: Object.fromEntries(steps.map((s, i) => [s.id, { x: WIDE_PITCH / 2 + i * WIDE_PITCH, y: 20 }])),
  edges: Object.fromEntries(
    steps.slice(1).map((s, i) => [
      s.id,
      route([
        { x: WIDE_PITCH / 2 + i * WIDE_PITCH, y: 20 },
        { x: WIDE_PITCH / 2 + (i + 1) * WIDE_PITCH, y: 20 },
      ]),
    ]),
  ),
};

export function TeachingFlow() {
  return (
    <WorkflowDiagram
      label="How teaching works"
      loop
      narrow={narrow}
      wide={wide}
      nodes={steps.map((step, beat) => ({ ...step, beat }))}
      edges={steps.slice(1).map((step, i) => ({ id: step.id, beat: i + 1 }))}
    />
  );
}
