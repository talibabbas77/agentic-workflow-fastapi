import type { Metadata } from "next";
import { ClosingCta } from "@/components/marketing/closing-cta";
import {
  faqCap,
  faqChangePlan,
  faqFiles,
  faqLiveChat,
  faqPages,
  faqReplies,
  FaqSection,
} from "@/components/marketing/faq";
import { ComparisonTable, PlansUnavailable } from "@/components/marketing/plans";
import { PricingBlock } from "@/components/marketing/pricing-block";
import { container, PageIntro, Section } from "@/components/marketing/section";
import { cn } from "@/lib/cn";
import { getPlans } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Docent plans are priced by AI replies per month, with a hard cap. At the cap the widget becomes a contact form, so there is never overage.",
};

export default async function PricingPage() {
  const plans = await getPlans();
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Priced by replies, with a hard cap">
        <p>
          Plans are priced by AI replies per month, in US dollars. Every plan has a hard cap, so the bill is the same
          every month, and every plan starts with the free trial.
        </p>
      </PageIntro>

      <section aria-labelledby="plans-heading" className={cn(container, "pb-20 sm:pb-24 lg:pb-28")}>
        <h2 id="plans-heading" className="sr-only">
          Plans and prices
        </h2>
        <PricingBlock />
      </section>

      <Section
        id="compare"
        eyebrow="Compare"
        title="Every plan, side by side"
        intro="What each plan includes, row by row. Plans differ in how many replies, pages of docs, widgets, and seats they include."
      >
        {plans ? <ComparisonTable plans={plans} /> : <PlansUnavailable />}
      </Section>

      <FaqSection
        intro="How replies are counted, what happens at the cap, and what a page of docs is."
        items={[faqReplies, faqCap, faqChangePlan, faqPages, faqFiles, faqLiveChat]}
      />

      <ClosingCta />
    </>
  );
}
