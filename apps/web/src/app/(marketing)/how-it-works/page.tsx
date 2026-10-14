import { CheckIcon, MinusIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { HowItWorksExplorer } from "@/components/marketing/how-it-works";
import { container, PageIntro, Section } from "@/components/marketing/section";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Docent learns from your docs, answers with citations, knows which customer is asking, and hands conversations to your team by email.",
};

const modes: {
  title: string;
  setup: string;
  body: string;
  yes: string[];
  no: string[];
}[] = [
  {
    title: "Anonymous mode",
    setup: "One script tag",
    body: "For visitors who are not signed in. Docent answers from the sources you mark for everyone, with tighter rate limits. You can turn it off.",
    yes: ["Answers from public docs, with citations", "Handoffs, with the visitor's email", "Rate limits per visitor and per day"],
    no: ["No account details", "Never sees signed-in content"],
  },
  {
    title: "Identified mode",
    setup: "A small signing step on your server",
    body: "For customers who are logged in to your product. Your server signs a short-lived token, and Docent answers for that account.",
    yes: [
      "Answers that use the fields you allow, such as plan",
      "Sources marked for signed-in customers",
      "Handoffs that carry the customer's details",
    ],
    no: ["Never reads your cookies or storage", "Ignores names and ids typed into the chat"],
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro eyebrow="How it works" title="From your docs to an answer, or to your team">
        <p>
          Four parts: you teach the agent from your docs, it answers in a widget on your site, it can know which
          customer is asking, and it hands the rest to your team. Pick a step to see what happens and where it stops.
        </p>
      </PageIntro>

      <section aria-labelledby="steps-heading" className={cn(container, "pb-20 sm:pb-24 lg:pb-28")}>
        <h2 id="steps-heading" className="sr-only">
          The four steps
        </h2>
        <HowItWorksExplorer />
      </section>

      <Section
        id="modes"
        eyebrow="Two modes"
        title="Anonymous visitors and signed-in customers"
        intro={
          <p>
            One widget can serve both. Anonymous mode is a script tag. Identified mode adds a token your server signs,
            and the <TextLink href="/docs#identified">install guide</TextLink> has snippets for Node, Python, Ruby,
            PHP, and Go.
          </p>
        }
      >
        <div className="mk-reveal grid gap-4 md:grid-cols-2">
          {modes.map((mode) => (
            <article key={mode.title} className="flex flex-col rounded-lg border border-line bg-surface">
              <header className="flex flex-col gap-1 border-b border-line px-6 py-5">
                <h3 className="text-lg text-ink">{mode.title}</h3>
                <p className="text-sm text-ink-muted">Setup: {mode.setup}</p>
              </header>
              <div className="flex flex-1 flex-col gap-5 px-6 py-5">
                <p className="text-base text-ink-muted">{mode.body}</p>
                <ul className="flex flex-col gap-2.5 text-base text-ink">
                  {mode.yes.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <CheckIcon aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-ink" weight="bold" />
                      {item}
                    </li>
                  ))}
                  {mode.no.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-ink-muted">
                      <MinusIcon aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-rust" weight="bold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </Section>

      <ClosingCta title="Ready to try it with your own docs" />
    </>
  );
}
