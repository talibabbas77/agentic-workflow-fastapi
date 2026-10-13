import {
  ArrowsSplitIcon,
  ChatCircleTextIcon,
  HeadsetIcon,
  MagnifyingGlassIcon,
  SealCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import { route, WorkflowDiagram, type WorkflowLayout } from "./workflow-diagram";

/*
 * "How Docent answers": a visitor asks, Docent searches the docs it was taught,
 * then either answers with sources or hands the conversation to a person.
 */

// One column, so labels stay full size on a phone. The branch to "No supporting
// source" brackets down the left side, past the answer it replaces.
const narrow: WorkflowLayout = {
  width: 320,
  height: 376,
  labelWidth: 240,
  nodes: {
    ask: { x: 40, y: 20 },
    search: { x: 40, y: 100 },
    answer: { x: 40, y: 180 },
    nosource: { x: 40, y: 276 },
    handoff: { x: 40, y: 356 },
  },
  edges: {
    "ask-search": route([
      { x: 40, y: 20 },
      { x: 40, y: 100 },
    ]),
    "search-answer": route([
      { x: 40, y: 100 },
      { x: 40, y: 180 },
    ]),
    "search-nosource": route([
      { x: 40, y: 100 },
      { x: 6, y: 100 },
      { x: 6, y: 276 },
      { x: 40, y: 276 },
    ]),
    "nosource-handoff": route([
      { x: 40, y: 276 },
      { x: 40, y: 356 },
    ]),
  },
};

const wide: WorkflowLayout = {
  width: 740,
  height: 224,
  labelWidth: 176,
  nodes: {
    ask: { x: 68, y: 20 },
    search: { x: 268, y: 20 },
    answer: { x: 468, y: 20 },
    nosource: { x: 468, y: 150 },
    handoff: { x: 668, y: 150 },
  },
  edges: {
    "ask-search": route([
      { x: 68, y: 20 },
      { x: 268, y: 20 },
    ]),
    "search-answer": route([
      { x: 268, y: 20 },
      { x: 468, y: 20 },
    ]),
    "search-nosource": route([
      { x: 268, y: 20 },
      { x: 368, y: 20 },
      { x: 368, y: 150 },
      { x: 468, y: 150 },
    ]),
    "nosource-handoff": route([
      { x: 468, y: 150 },
      { x: 668, y: 150 },
    ]),
  },
};

export function AnswerFlow({ className }: { className?: string }) {
  return (
    <WorkflowDiagram
      label="How Docent answers a question"
      loop
      className={className}
      narrow={narrow}
      wide={wide}
      nodes={[
        {
          id: "ask",
          icon: <ChatCircleTextIcon />,
          title: "A visitor asks a question",
          detail: "In the widget on your site",
          beat: 0,
        },
        {
          id: "search",
          icon: <MagnifyingGlassIcon />,
          title: "Docent searches your docs",
          detail: "Only what you taught it",
          beat: 1,
        },
        {
          id: "answer",
          icon: <SealCheckIcon />,
          title: "Answers with sources",
          detail: "Each answer cites its page",
          beat: 2,
        },
        {
          id: "nosource",
          icon: <ArrowsSplitIcon />,
          title: "No supporting source",
          detail: "It does not guess",
          beat: 3,
        },
        {
          id: "handoff",
          icon: <HeadsetIcon />,
          title: "Hands off to your team",
          detail: "With a summary of the chat",
          beat: 4,
        },
      ]}
      edges={[
        { id: "ask-search", beat: 1 },
        { id: "search-answer", beat: 2 },
        { id: "search-nosource", beat: 3 },
        { id: "nosource-handoff", beat: 4 },
      ]}
    />
  );
}
