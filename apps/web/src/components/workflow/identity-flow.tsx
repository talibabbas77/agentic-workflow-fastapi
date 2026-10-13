import {
  AppWindowIcon,
  KeyIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import { route, WorkflowDiagram, type WorkflowLayout } from "./workflow-diagram";

/*
 * "How Docent knows who is asking": your server signs a short-lived token for
 * the logged-in user, the widget passes it on, Docent checks the signature with
 * your public key, and answers for that account only.
 */

const narrow: WorkflowLayout = {
  width: 320,
  height: 296,
  labelWidth: 248,
  nodes: {
    sign: { x: 20, y: 20 },
    widget: { x: 20, y: 104 },
    verify: { x: 20, y: 188 },
    answer: { x: 20, y: 272 },
  },
  edges: {
    "sign-widget": route([
      { x: 20, y: 20 },
      { x: 20, y: 104 },
    ]),
    "widget-verify": route([
      { x: 20, y: 104 },
      { x: 20, y: 188 },
    ]),
    "verify-answer": route([
      { x: 20, y: 188 },
      { x: 20, y: 272 },
    ]),
  },
};

const wide: WorkflowLayout = {
  width: 740,
  height: 112,
  labelWidth: 176,
  nodes: {
    sign: { x: 68, y: 20 },
    widget: { x: 268, y: 20 },
    verify: { x: 468, y: 20 },
    answer: { x: 668, y: 20 },
  },
  edges: {
    "sign-widget": route([
      { x: 68, y: 20 },
      { x: 268, y: 20 },
    ]),
    "widget-verify": route([
      { x: 268, y: 20 },
      { x: 468, y: 20 },
    ]),
    "verify-answer": route([
      { x: 468, y: 20 },
      { x: 668, y: 20 },
    ]),
  },
};

export function IdentityFlow() {
  return (
    <WorkflowDiagram
      label="How Docent knows who is asking"
      loop
      narrow={narrow}
      wide={wide}
      nodes={[
        {
          id: "sign",
          icon: <KeyIcon />,
          title: "Your server signs a token",
          detail: "For the user who is logged in",
          beat: 0,
        },
        {
          id: "widget",
          icon: <AppWindowIcon />,
          title: "The widget passes it on",
          detail: "Held in memory, never in cookies",
          beat: 1,
        },
        {
          id: "verify",
          icon: <ShieldCheckIcon />,
          title: "Docent checks the signature",
          detail: "With your public key",
          beat: 2,
        },
        {
          id: "answer",
          icon: <UserCheckIcon />,
          title: "Answers for that account",
          detail: "Their plan and details in context",
          beat: 3,
        },
      ]}
      edges={[
        { id: "sign-widget", beat: 1 },
        { id: "widget-verify", beat: 2 },
        { id: "verify-answer", beat: 3 },
      ]}
    />
  );
}
