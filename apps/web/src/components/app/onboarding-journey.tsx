import type { Onboarding, OnboardingStep, Role } from "@docent/api-client";
import {
  BookOpenTextIcon,
  BuildingsIcon,
  ChatCircleTextIcon,
  CheckIcon,
  CodeIcon,
  EnvelopeSimpleIcon,
  LockSimpleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  route,
  WorkflowDiagram,
  type EdgeState,
  type NodeState,
  type WorkflowLayout,
  type WorkflowNodeSpec,
} from "@/components/workflow/workflow-diagram";
import { ResendVerificationNode } from "./resend-verification";

type Key = OnboardingStep["key"];

const steps: { key: Key; title: string; icon: ReactNode; todo: string }[] = [
  { key: "create_workspace", title: "Create workspace", icon: <BuildingsIcon />, todo: "Name your workspace" },
  { key: "verify_email", title: "Confirm email", icon: <EnvelopeSimpleIcon />, todo: "Send a new link" },
  { key: "invite_team", title: "Invite your team", icon: <UserPlusIcon />, todo: "Add a teammate" },
  { key: "teach_agent", title: "Teach the agent", icon: <BookOpenTextIcon />, todo: "Add your docs" },
  { key: "install_widget", title: "Install the widget", icon: <CodeIcon />, todo: "Add it to your site" },
  { key: "first_answer", title: "First answer", icon: <ChatCircleTextIcon />, todo: "Ask a test question" },
];

const NARROW_PITCH = 64;
const WIDE_PITCH = 140;

const narrow: WorkflowLayout = {
  width: 320,
  height: 20 + NARROW_PITCH * (steps.length - 1) + 20,
  labels: "right",
  labelWidth: 260,
  nodes: Object.fromEntries(steps.map((s, i) => [s.key, { x: 20, y: 20 + i * NARROW_PITCH }])),
  edges: Object.fromEntries(
    steps.slice(1).map((s, i) => [
      s.key,
      route([
        { x: 20, y: 20 + i * NARROW_PITCH },
        { x: 20, y: 20 + (i + 1) * NARROW_PITCH },
      ]),
    ]),
  ),
};

const wide: WorkflowLayout = {
  width: WIDE_PITCH * steps.length,
  height: 92,
  labels: "below",
  labelWidth: 128,
  nodes: Object.fromEntries(steps.map((s, i) => [s.key, { x: WIDE_PITCH / 2 + i * WIDE_PITCH, y: 20 }])),
  edges: Object.fromEntries(
    steps.slice(1).map((s, i) => [
      s.key,
      route([
        { x: WIDE_PITCH / 2 + i * WIDE_PITCH, y: 20 },
        { x: WIDE_PITCH / 2 + (i + 1) * WIDE_PITCH, y: 20 },
      ]),
    ]),
  ),
};

export function OnboardingJourney({ onboarding, role }: { onboarding: Onboarding; role: Role }) {
  const status = new Map(onboarding.steps.map((s) => [s.key, s.status]));
  const ordered = steps.map((s) => ({ ...s, status: status.get(s.key) ?? "locked" }));
  const firstTodo = ordered.findIndex((s) => s.status === "todo");
  const lastDone = ordered.reduce((last, s, i) => (s.status === "done" ? i : last), -1);
  const canInvite = role === "owner" || role === "admin";

  const nodes: WorkflowNodeSpec[] = ordered.map((step, index) => {
    let state: NodeState = step.status === "done" ? "done" : step.status === "locked" ? "locked" : "todo";
    if (index === firstTodo) state = "current";

    const node: WorkflowNodeSpec = {
      id: step.key,
      title: step.title,
      icon: state === "done" ? <CheckIcon weight="bold" /> : step.icon,
      state,
    };

    if (step.status === "done") {
      node.detail = "Done";
      node.status = "Done";
    } else if (step.status === "locked") {
      node.detail = "Not available yet";
      node.tooltip = "Not available yet";
      node.status = "Not available yet";
      node.badge = <LockSimpleIcon weight="bold" />;
    } else {
      node.detail = step.todo;
      node.status = "To do";
      if (step.key === "verify_email") {
        node.render = (content, className) => (
          <ResendVerificationNode className={className}>{content}</ResendVerificationNode>
        );
      } else if (step.key === "invite_team") {
        if (canInvite) {
          node.render = (content, className) => (
            <Link href="/app/settings/members?invite=1" className={className}>
              {content}
            </Link>
          );
        } else {
          node.detail = "Owners and admins invite";
        }
      }
    }
    return node;
  });

  const edges = ordered.slice(1).map((step, i) => {
    const target = i + 1;
    let state: EdgeState = "idle";
    if (target === firstTodo) state = "active";
    else if (target <= lastDone) state = "done";
    else if (step.status === "locked") state = "locked";
    return { id: step.key, state };
  });

  return <WorkflowDiagram label="Setup steps" nodes={nodes} edges={edges} narrow={narrow} wide={wide} />;
}
