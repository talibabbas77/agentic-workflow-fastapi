import {
  EnvelopeSimpleIcon,
  FileMagnifyingGlassIcon,
  NotePencilIcon,
  ShieldWarningIcon,
  TrayIcon,
  UserSoundIcon,
} from "@phosphor-icons/react/dist/ssr";
import { route, WorkflowDiagram, type WorkflowLayout } from "./workflow-diagram";

/*
 * "Handoff to your team": any of three reasons stops the agent, it writes a
 * summary, the conversation lands in your inbox, and your team replies by email.
 * The three reasons light up together; they are alternatives, not steps.
 */

const triggers = ["nosource", "person", "restricted"] as const;

const narrow: WorkflowLayout = {
  width: 320,
  height: 380,
  labelWidth: 220,
  nodes: {
    nosource: { x: 60, y: 20 },
    person: { x: 60, y: 84 },
    restricted: { x: 60, y: 148 },
    summary: { x: 20, y: 232 },
    inbox: { x: 20, y: 296 },
    email: { x: 20, y: 360 },
  },
  edges: {
    ...Object.fromEntries(
      triggers.map((id, i) => [
        `${id}-summary`,
        route([
          { x: 60, y: 20 + i * 64 },
          { x: 20, y: 20 + i * 64 },
          { x: 20, y: 232 },
        ]),
      ]),
    ),
    "summary-inbox": route([
      { x: 20, y: 232 },
      { x: 20, y: 296 },
    ]),
    "inbox-email": route([
      { x: 20, y: 296 },
      { x: 20, y: 360 },
    ]),
  },
};

const wide: WorkflowLayout = {
  width: 820,
  height: 300,
  labelWidth: 156,
  nodes: {
    nosource: { x: 90, y: 20 },
    person: { x: 90, y: 130 },
    restricted: { x: 90, y: 240 },
    summary: { x: 340, y: 130 },
    inbox: { x: 540, y: 130 },
    email: { x: 740, y: 130 },
  },
  edges: {
    ...Object.fromEntries(
      triggers.map((id, i) => [
        `${id}-summary`,
        route([
          { x: 90, y: 20 + i * 110 },
          { x: 215, y: 20 + i * 110 },
          { x: 215, y: 130 },
          { x: 340, y: 130 },
        ]),
      ]),
    ),
    "summary-inbox": route([
      { x: 340, y: 130 },
      { x: 540, y: 130 },
    ]),
    "inbox-email": route([
      { x: 540, y: 130 },
      { x: 740, y: 130 },
    ]),
  },
};

export function HandoffFlow() {
  return (
    <WorkflowDiagram
      label="How Docent hands a conversation to your team"
      loop
      narrow={narrow}
      wide={wide}
      nodes={[
        {
          id: "nosource",
          icon: <FileMagnifyingGlassIcon />,
          title: "No supporting source",
          detail: "Your docs do not cover it",
          beat: 0,
        },
        {
          id: "person",
          icon: <UserSoundIcon />,
          title: "Asked for a person",
          detail: "Wants a human",
          beat: 0,
        },
        {
          id: "restricted",
          icon: <ShieldWarningIcon />,
          title: "Restricted topic",
          detail: "Legal, security, billing",
          beat: 0,
        },
        {
          id: "summary",
          icon: <NotePencilIcon />,
          title: "Summary written",
          detail: "What was asked and tried",
          beat: 1,
        },
        { id: "inbox", icon: <TrayIcon />, title: "Your inbox", detail: "Waiting for your team", beat: 2 },
        { id: "email", icon: <EnvelopeSimpleIcon />, title: "Reply by email", detail: "To the customer's address", beat: 3 },
      ]}
      edges={[
        ...triggers.map((id) => ({ id: `${id}-summary`, beat: 1 })),
        { id: "summary-inbox", beat: 2 },
        { id: "inbox-email", beat: 3 },
      ]}
    />
  );
}
