import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { container, PageIntro, Section } from "@/components/marketing/section";
import { SecurityBento, WillWont } from "@/components/marketing/trust";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Docent keeps each company's data apart, verifies who is asking, isolates the widget, and handles retention and backups.",
};

export default function SecurityPage() {
  return (
    <>
      <PageIntro eyebrow="Security" title="How Docent keeps your data apart">
        <p>
          Docent holds your help content and your customers&apos; questions. This page says plainly how that data is
          kept apart, who can read it, and how long we keep it.
        </p>
      </PageIntro>

      <section aria-labelledby="facts-heading" className={cn(container, "pb-20 sm:pb-24 lg:pb-28")}>
        <h2 id="facts-heading" className="sr-only">
          How your data is handled
        </h2>
        <SecurityBento />
      </section>

      <Section
        id="limits"
        eyebrow="Boundaries"
        title="What Docent will and will not do"
        intro="The agent has a narrow job and fixed limits. These hold on every plan, whatever a visitor types."
      >
        <WillWont />
      </Section>

      <Section
        id="report"
        eyebrow="Reporting"
        title="Reporting a problem"
        intro={
          <p>
            If you find a security issue, please tell us before you tell anyone else. Write to the address below with
            &quot;Security&quot; in the subject, or see the <TextLink href="/contact">contact page</TextLink>. We reply
            to every report.
          </p>
        }
      >
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Security`}
          className="mk-reveal inline-flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-4 text-md font-medium text-ink transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
        >
          <EnvelopeSimpleIcon aria-hidden="true" className="size-5 text-rust" />
          {CONTACT_EMAIL}
        </a>
      </Section>
    </>
  );
}
