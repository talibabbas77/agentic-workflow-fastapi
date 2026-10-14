import {
  BookOpenTextIcon,
  SealCheckIcon,
  TrayIcon,
  UserCheckIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Bubble, Ref, SourceChip, TypingDots } from "./chat-bits";
import { HeroDemoClient, type ScenarioId, type ScenarioOption } from "./hero-demo-client";

const options: ScenarioOption[] = [
  {
    id: "anonymous",
    title: "Anonymous visitor",
    sub: "Public docs only",
    signedIn: false,
    summary:
      "Anonymous visitor. Docent answered from the public refunds article, covered both plans, and cited the article.",
  },
  {
    id: "ana",
    title: "Signed in as Ana",
    sub: "Team plan",
    signedIn: true,
    summary:
      "Signed in as Ana on the Team plan. Docent answered for her plan, cited the refunds article, and noted it used her account.",
  },
  {
    id: "person",
    title: "Asks for a person",
    sub: "Hands off to the team",
    signedIn: true,
    summary: "Asks for a person. Docent handed the conversation to the Lumen Notes team with a summary.",
  },
];

const refundsChip = <SourceChip n={1}>Billing and refunds {">"} Refunds</SourceChip>;

const conversation: Record<ScenarioId, { question: string; answer: ReactNode; details: ReactNode }> = {
  anonymous: {
    question: "Can I get a refund on my yearly plan?",
    answer: (
      <>
        Yes. Yearly plans can be refunded in full within 30 days of payment
        <Ref n={1} />. On Personal, ask from Settings, then Account. On Team, a workspace admin asks from Settings, then
        Billing
        <Ref n={1} />.
      </>
    ),
    details: refundsChip,
  },
  ana: {
    question: "Can I get a refund on my yearly plan?",
    answer: (
      <>
        Yes, within 30 days of payment
        <Ref n={1} />. You are on the Team plan, so a workspace admin asks for it from Settings, then Billing
        <Ref n={1} />.
      </>
    ),
    details: (
      <>
        {refundsChip}
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <UserCheckIcon aria-hidden="true" className="size-3.5" />
          From your account: plan
        </p>
      </>
    ),
  },
  person: {
    question: "Can I get a refund on my yearly plan? I would rather talk to a person.",
    answer: (
      <>
        Of course. I have passed this to the Lumen Notes team with a summary, so you will not need to repeat yourself.
        They will reply by email.
      </>
    ),
    details: (
      <div className="flex flex-col gap-2.5 rounded-lg border border-rust-soft bg-rust-soft px-3.5 py-3 text-sm text-ink">
        <p className="flex items-center gap-2 font-medium">
          <TrayIcon aria-hidden="true" className="size-4 text-rust" />
          Handed to the Lumen Notes team
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-ink-muted">Reason</dt>
          <dd>Asked for a person</dd>
          <dt className="text-ink-muted">Ticket</dt>
          <dd>Billing</dd>
          <dt className="text-ink-muted">Summary</dt>
          <dd>Ana, on the Team plan, wants a refund on her yearly plan and asked for a person.</dd>
        </dl>
      </div>
    ),
  },
};

/** One step of the conversation; CSS shows it once the demo's phase reaches `at`. */
function Step({ at, className, children }: { at: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("mk-step flex flex-col gap-2", className)} data-at={at}>
      {children}
    </div>
  );
}

function Conversation({ id }: { id: ScenarioId }) {
  const { question, answer, details } = conversation[id];
  return (
    <div className="flex flex-col gap-3">
      <Step at={0}>
        <Bubble from="visitor">{question}</Bubble>
      </Step>
      <div className="relative flex flex-col gap-2">
        <div className="mk-typing absolute top-0 left-0">
          <TypingDots />
        </div>
        <Step at={2}>
          <Bubble from="agent">{answer}</Bubble>
        </Step>
        <Step at={3}>{details}</Step>
      </div>
    </div>
  );
}

/** The strip under the panel: what Docent was told about the visitor, and by whom. */
function Knows({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <p className="flex shrink-0 items-center gap-2 text-sm font-medium text-ink">
        <BookOpenTextIcon aria-hidden="true" className="size-4 text-ink-muted" />
        What Docent knows
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

/**
 * The hero demo: a framed, faithful mock of the Docent chat panel. The same
 * question gets a different answer depending on who is asking. Everything is
 * fictional and labeled as an example. Content is rendered here on the server;
 * the client part only switches scenarios and plays the reply.
 */
export function HeroDemo() {
  return (
    <div className="min-w-0">
      {/* Without script the conversation shows in full. */}
      <noscript
        dangerouslySetInnerHTML={{
          __html: "<style>.mk-scenario .mk-step{visibility:inherit!important}.mk-typing{display:none!important}</style>",
        }}
      />
      <HeroDemoClient
        options={options}
        close={<XIcon className="size-4.5" />}
        conversations={{
          anonymous: <Conversation id="anonymous" />,
          ana: <Conversation id="ana" />,
          person: <Conversation id="person" />,
        }}
        knows={{
          anonymous: (
            <Knows>
              <span className="text-sm font-medium text-ink">Nothing</span>
              <span className="text-sm text-ink-muted">Public docs only</span>
            </Knows>
          ),
          signedIn: (
            <Knows>
              <code className="rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-sm text-ink">
                {'{ plan: "Team" }'}
              </code>
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                <SealCheckIcon aria-hidden="true" className="size-4 text-ink" />
                Signature checked
              </span>
            </Knows>
          ),
        }}
      />
    </div>
  );
}
