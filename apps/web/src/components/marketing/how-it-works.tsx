import {
  ChatCircleTextIcon,
  FingerprintIcon,
  HeadsetIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { AnswerFlow } from "@/components/workflow/answer-flow";
import { HandoffFlow } from "@/components/workflow/handoff-flow";
import { IdentityFlow } from "@/components/workflow/identity-flow";
import { TeachingFlow } from "@/components/workflow/teaching-flow";
import { WorkflowExplorer } from "./workflow-explorer";

type Point = { title: string; body: ReactNode };

type Step = {
  id: string;
  tab: string;
  sub: string;
  icon: ReactNode;
  title: string;
  diagram: ReactNode;
  points: [Point, Point, Point];
  /** One line on the mechanism underneath. */
  detail: ReactNode;
};

const steps: Step[] = [
  {
    id: "teach",
    tab: "Teach",
    sub: "Add your docs",
    icon: <UploadSimpleIcon />,
    title: "Teach the agent",
    diagram: <TeachingFlow />,
    points: [
      {
        title: "Add what you already have",
        body: "PDF, Word, Markdown, text, and HTML files up to 20 MB each, a single web page, or a sitemap of up to 200 pages.",
      },
      {
        title: "It reads and indexes",
        body: "Docent extracts the text, splits it into short passages under their headings, and indexes each one by meaning and by keyword.",
      },
      {
        title: "You choose who sees what",
        body: "Mark each source for everyone or for signed-in customers only. Anonymous visitors never get answers from signed-in content.",
      },
    ],
    detail:
      "Passages are about 400 tokens, never cross a top-level heading, and keep their heading path, such as Billing > Refunds, so a citation points to the exact place.",
  },
  {
    id: "answer",
    tab: "Answer",
    sub: "Cite the page or stop",
    icon: <ChatCircleTextIcon />,
    title: "Answer with sources",
    diagram: <AnswerFlow />,
    points: [
      {
        title: "Search first",
        body: "For each question Docent finds the most relevant passages in your sources before anything is written.",
      },
      {
        title: "Cite the page",
        body: "The answer marks each sentence with the passage it used and links to that page, so anyone can check it.",
      },
      {
        title: "No source, no answer",
        body: "If no passage supports an answer, it says so and hands over. It does not fill the gap from general knowledge.",
      },
    ],
    detail:
      "Search runs by meaning and by keyword, merges the two, and keeps the best 8 passages. If none clears the evidence threshold, no answer is written from them.",
  },
  {
    id: "identify",
    tab: "Identify",
    sub: "Know who is asking",
    icon: <FingerprintIcon />,
    title: "Know who is asking",
    diagram: <IdentityFlow />,
    points: [
      {
        title: "Your server signs",
        body: "When a customer is logged in, your backend signs a short-lived token with their user id and the fields you allow, such as plan.",
      },
      {
        title: "Docent verifies",
        body: "It checks the signature with the public key you uploaded. It never reads your cookies or the storage on your site.",
      },
      {
        title: "Typing changes nothing",
        body: "Who the customer is comes from the token. A name or user id typed into the chat is treated as text, not identity.",
      },
    ],
    detail:
      "Before a session starts Docent checks the ES256 signature, key id, audience, issuer, a lifetime of at most 15 minutes, and a token id that works once.",
  },
  {
    id: "handoff",
    tab: "Hand off",
    sub: "Your team takes over",
    icon: <HeadsetIcon />,
    title: "Hand off to your team",
    diagram: <HandoffFlow />,
    points: [
      {
        title: "When it hands off",
        body: "No source supports an answer, the customer asks for a person, or the topic is restricted, such as legal questions or billing disputes.",
      },
      {
        title: "What your team gets",
        body: "The conversation and a short summary of what was asked and tried, with the customer's details when they are signed in.",
      },
      {
        title: "How you reply",
        body: "Your team replies by email from the inbox, and the customer gets it by email. There is no live chat in this version.",
      },
    ],
    detail:
      "The summary covers the issue, what was tried, who the customer is, and a suggested next step. The agent picks the closest of your ticket types and fills its fields.",
  },
];

/** The four steps as one tabbed explorer, with each diagram in a large panel. */
export function HowItWorksExplorer() {
  return (
    <WorkflowExplorer
      label="How Docent works"
      steps={steps.map((step, index) => ({
        id: step.id,
        title: step.tab,
        sub: step.sub,
        icon: step.icon,
        panel: <Panel step={step} index={index} />,
      }))}
    />
  );
}

function Panel({ step, index }: { step: Step; index: number }) {
  return (
    <article className="rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 sm:px-6">
        <h3 className="text-md text-ink">{step.title}</h3>
        <span className="text-sm text-ink-muted tabular-nums">
          Step {index + 1} of {steps.length}
        </span>
      </header>
      <div className="px-4 py-10 sm:px-8 sm:py-12">{step.diagram}</div>
      <ol className="grid border-t border-line md:grid-cols-3">
        {step.points.map((point, i) => (
          <li
            key={point.title}
            className="flex gap-3 border-line px-5 py-5 not-first:border-t sm:px-6 md:not-first:border-t-0 md:not-first:border-l"
          >
            <span
              aria-hidden="true"
              className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-medium text-ink tabular-nums"
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h4 className="text-base font-medium text-ink">{point.title}</h4>
              <p className="text-base text-ink-muted">{point.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="rounded-b-lg border-t border-line bg-paper px-5 py-3.5 text-sm text-ink-muted sm:px-6">
        <span className="font-medium text-ink">Underneath: </span>
        {step.detail}
      </p>
    </article>
  );
}
