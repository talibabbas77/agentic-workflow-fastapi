import {
  CookieIcon,
  EnvelopeSimpleIcon,
  GaugeIcon,
  ProhibitIcon,
  QuotesIcon,
  UserSoundIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExampleConversation } from "@/components/marketing/example-conversation";
import { PlansUnavailable, PlanSummary } from "@/components/marketing/plans";
import { DiagramPanel, Section } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";
import { AnswerFlow } from "@/components/workflow/answer-flow";
import { HandoffFlow } from "@/components/workflow/handoff-flow";
import { IdentityFlow } from "@/components/workflow/identity-flow";
import { TeachingFlow } from "@/components/workflow/teaching-flow";
import { getPlans } from "@/lib/plans";

export const metadata: Metadata = {
  title: { absolute: "Docent: support answers from your docs, not guesses" },
  description:
    "Docent answers customer questions only from the documents you teach it, cites the page it used, and hands everything else to your team by email.",
};

const limits: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <QuotesIcon />,
    title: "Guess",
    body: "Without a passage that supports an answer, it says so and hands the conversation to your team.",
  },
  {
    icon: <EnvelopeSimpleIcon />,
    title: "Offer live chat",
    body: "Handoffs reach your team in an inbox and your team replies by email. Live chat is not part of this version.",
  },
  {
    icon: <CookieIcon />,
    title: "Read your cookies",
    body: "It never reads cookies or storage on your site. It only knows what your server signs.",
  },
  {
    icon: <UserSoundIcon />,
    title: "Trust a name typed into the chat",
    body: "Who the customer is comes from the signed token, not from anything they type.",
  },
  {
    icon: <GaugeIcon />,
    title: "Go dark at the cap",
    body: "When a plan reaches its monthly cap, the widget becomes a contact form for your team.",
  },
  {
    icon: <ProhibitIcon />,
    title: "Train models on your data",
    body: "Your documents and your customers' conversations are never used to train models.",
  },
];

export default function HomePage() {
  return (
    <>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16">
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl text-ink sm:text-4xl">Support answers from your docs, not guesses</h1>
          <p className="max-w-xl text-lg text-ink-muted">
            Your team answers the same questions every day, and most support bots fill the gaps by guessing. Docent
            answers only from the documents you teach it, cites the page it used, and hands everything else to your
            team.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup">Start free trial</ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary">
              See how it works
            </ButtonLink>
          </div>
        </div>
        <ExampleConversation />
      </div>

      <Section
        id="answers"
        title="How Docent answers"
        intro="A customer asks in the widget on your site. Docent searches only the sources you added. When a passage supports an answer, it replies and cites the page. When nothing does, it says so and hands over."
      >
        <DiagramPanel>
          <AnswerFlow />
        </DiagramPanel>
      </Section>

      <Section
        id="identity"
        title="How it knows who is asking"
        intro="Your server signs a short-lived token for the logged-in user. Docent checks the signature with your public key and answers for that account, with their plan and account id in context."
      >
        <DiagramPanel>
          <IdentityFlow />
        </DiagramPanel>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <ModeNote title="Anonymous mode">
            One script tag. Docent answers visitors from the docs you mark for everyone.
          </ModeNote>
          <ModeNote title="Identified mode">
            Needs a small signing step on your server. Answers can use the customer&apos;s plan and account.
          </ModeNote>
        </dl>
      </Section>

      <Section
        id="teaching"
        title="Teach the agent from your docs"
        intro="Upload PDF, Word, Markdown, text, or HTML files, or point it at a page or a sitemap. Docent reads them, splits them into passages, and indexes them for search. Re-sync when your docs change."
      >
        <DiagramPanel>
          <TeachingFlow />
        </DiagramPanel>
      </Section>

      <Section
        id="handoff"
        title="Handoff to your team"
        intro="Docent hands the conversation over when no source supports an answer, when the customer asks for a person, or when the topic is restricted, such as legal questions, security reports, account deletion, or billing disputes. It writes a summary so nobody starts over. In this version your team replies by email, not live chat."
      >
        <DiagramPanel>
          <HandoffFlow />
        </DiagramPanel>
      </Section>

      <Section id="limits" title="What it will not do">
        <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {limits.map((item) => (
            <li key={item.title} className="flex flex-col gap-2 bg-surface p-5 sm:p-6">
              <h3 className="flex items-center gap-2.5 text-md text-ink">
                <span aria-hidden="true" className="text-xl text-rust">
                  {item.icon}
                </span>
                <span className="sr-only">It will not </span>
                {item.title}
              </h3>
              <p className="text-base text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="pricing"
        title="Priced by replies, with a hard cap"
        intro="Plans are priced by AI replies per month. At the cap the widget switches to a contact form, so customers still reach a person and you never pay overage."
      >
        <Plans />
      </Section>

      <section aria-labelledby="start-heading" className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-8 sm:py-20 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 id="start-heading" className="text-2xl text-ink sm:text-3xl">
              Teach the agent and try it on your own site
            </h2>
            <p className="text-md text-ink-muted">
              Add your docs during the trial and test it with real questions before you pay.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup">Start free trial</ButtonLink>
            <ButtonLink href="/docs" variant="secondary">
              Read the install guide
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

function ModeNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface px-5 py-4">
      <dt className="font-medium text-ink">{title}</dt>
      <dd className="text-base text-ink-muted">{children}</dd>
    </div>
  );
}

async function Plans() {
  const plans = await getPlans();
  return plans ? <PlanSummary plans={plans} /> : <PlansUnavailable />;
}
