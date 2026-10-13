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

const narrow: WorkflowLayout = {
  width: 480,
  height: 296,
  labelWidth: 196,
  nodes: {
    ask: { x: 20, y: 20 },
    search: { x: 20, y: 104 },
    answer: { x: 20, y: 188 },
    nosource: { x: 268, y: 188 },
    handoff: { x: 268, y: 272 },
  },
  edges: {
    "ask-search": route([
      { x: 20, y: 20 },
      { x: 20, y: 104 },
    ]),
    "search-answer": route([
      { x: 20, y: 104 },
      { x: 20, y: 188 },
    ]),
    "search-nosource": route([
      { x: 20, y: 104 },
      { x: 20, y: 146 },
      { x: 268, y: 146 },
      { x: 268, y: 188 },
    ]),
    "nosource-handoff": route([
      { x: 268, y: 188 },
      { x: 268, y: 272 },
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
