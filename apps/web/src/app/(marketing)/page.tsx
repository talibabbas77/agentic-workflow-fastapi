import {
  ArrowRightIcon,
  GaugeIcon,
  HeadsetIcon,
  QuotesIcon,
  UserCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClosingCta } from "@/components/marketing/closing-cta";
import {
  faqCap,
  faqFiles,
  faqIdentified,
  faqLiveChat,
  faqReplies,
  faqTraining,
  FaqSection,
  faqUnsure,
} from "@/components/marketing/faq";
import { FeatureBento } from "@/components/marketing/feature-bento";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { HowItWorksExplorer } from "@/components/marketing/how-it-works";
import { IdentityChecks } from "@/components/marketing/identity-section";
import { LiveShowcase } from "@/components/marketing/live-showcase";
import { PricingBlock } from "@/components/marketing/pricing-block";
import { ProblemContrast } from "@/components/marketing/problem-contrast";
import { container, Section } from "@/components/marketing/section";
import { TrustFacts, WillWont } from "@/components/marketing/trust";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: { absolute: "Docent: support answers from your docs, not guesses" },
  description:
    "Docent answers customer questions only from the documents you teach it, cites the page it used, and hands everything else to your team by email.",
};

const proof: { icon: ReactNode; label: string }[] = [
  { icon: <QuotesIcon />, label: "Cites the page it used" },
  { icon: <HeadsetIcon />, label: "Hands off when unsure" },
  { icon: <UserCheckIcon />, label: "Knows who is signed in" },
  { icon: <GaugeIcon />, label: "Hard monthly cap" },
];

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="hero-heading">
        <div
          className={cn(
            container,
            "grid items-center gap-14 pt-12 pb-20 sm:pt-16 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,31rem)] lg:gap-16 lg:pt-20 lg:pb-28",
          )}
        >
          <div className="flex flex-col gap-6">
            <p className="inline-flex items-center gap-2 self-start rounded-full border border-line-strong bg-surface py-1 pr-3 pl-2.5 text-sm text-ink">
              <span aria-hidden="true" className="mk-ribbon h-3 w-2 shrink-0" />
              Support agent for software companies
            </p>
            <h1 id="hero-heading" className="max-w-[16ch] text-3xl text-ink sm:text-4xl">
              Support answers from your docs, not guesses
            </h1>
            <p className="max-w-[54ch] text-lg text-ink-muted">
              Docent answers your customers only from the documents you teach it, and cites the page it used. When
              your docs do not cover a question, it hands the conversation to your team with a summary.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/signup">Start free trial</ButtonLink>
              <ButtonLink href="#how-it-works" variant="secondary">
                See how it works
              </ButtonLink>
            </div>
            <ul className="mt-4 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-6">
              {proof.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5 text-base text-ink">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-md text-rust"
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
          <HeroDemo />
        </div>
      </section>

      <Section
        id="problem"
        eyebrow="The problem"
        title="Most support bots guess when your docs run out"
        intro="A customer asks something your help center does not cover. A typical bot writes an answer anyway, in the same confident tone it uses when it is right, and nobody can tell the difference until the customer holds your team to it."
      >
        <ProblemContrast />
      </Section>

      {/* Right after the problem: the reader has just seen a bot guess, so the next step is to watch
          Docent cite or hand off on a real site, before the four-step explanation. */}
      <Section
        id="live"
        eyebrow="See it live"
        title="Try it on two sites we built"
        intro="Two fictional companies with the Docent widget installed, each taught from its own help center. Ask your own questions: one site is for anonymous visitors, the other for signed-in customers."
      >
        <LiveShowcase />
      </Section>

      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="Four steps, from your docs to an answer or to your team"
        intro="Docent only knows what you teach it. Pick a step to see what happens and where it stops. Each diagram follows the real order of operations."
      >
        <HowItWorksExplorer />
      </Section>

      <Section
        id="features"
        eyebrow="What you get"
        title="Everything the customer sees comes from your docs or your server"
        intro="Docent does one job: answer from what you taught it, know who is asking when your server says so, and hand everything else to a person. Every part below is in every plan, including the trial."
      >
        <FeatureBento />
      </Section>

      <Section
        id="identified"
        eyebrow="Identified mode"
        title="It knows who is asking because your server says so"
        intro="Most support bots know nothing about the person asking, or trust whatever the page tells them. With identified mode, your server signs a short-lived token for the logged-in customer, Docent checks it before a session starts, and answers can use their plan and account."
      >
        <IdentityChecks />
      </Section>

      <Section
        id="security"
        eyebrow="Security"
        title="Your data stays yours, and stays apart"
        intro="Docent holds your help content and your customers' questions. Here is how each is kept apart, what the agent is allowed to do, and what it will never do."
      >
        <div className="flex flex-col gap-4">
          <TrustFacts />
          <WillWont />
        </div>
      </Section>

      <Section
        id="pricing"
        eyebrow="Pricing"
        title="Priced by replies, with a hard cap"
        intro="Plans are priced by AI replies per month, in US dollars. At the cap the widget becomes a contact form, so customers still reach a person and you never pay overage."
        aside={
          <TextLink href="/pricing#compare" className="inline-flex items-center gap-1 text-base">
            Compare every plan
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </TextLink>
        }
      >
        <PricingBlock />
      </Section>

      <FaqSection
        intro="Plain answers about replies, caps, files, identity, and your data."
        items={[faqReplies, faqCap, faqUnsure, faqFiles, faqIdentified, faqTraining, faqLiveChat]}
      />

      <ClosingCta />
    </>
  );
}
