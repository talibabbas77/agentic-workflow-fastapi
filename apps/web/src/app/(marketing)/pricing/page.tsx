import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PlanCards, PlansUnavailable } from "@/components/marketing/plans";
import { PageIntro, Section } from "@/components/marketing/section";
import { getPlans } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Docent plans are priced by AI replies per month, with a hard cap. At the cap the widget becomes a contact form, so there is never overage.",
};

const faq: { question: string; answer: ReactNode }[] = [
  {
    question: "What is an AI reply?",
    answer:
      "One message the agent writes to a customer: an answer, a clarifying question, or the message that hands the conversation to your team. Emails your team sends do not count.",
  },
  {
    question: "What happens at the cap?",
    answer:
      "The widget shows a short message and a contact form for the rest of the month. Every message becomes a handoff in your inbox, so customers still reach your team. Owners and admins get an email at 80 percent, and owners again at the cap. You are never billed for overage.",
  },
  {
    question: "Can I change plans?",
    answer: "Yes, up or down at any time. Your reply cap moves with the plan.",
  },
  {
    question: "What are pages of docs?",
    answer:
      "How much content you can teach the agent. At the limit, new sources are refused with a clear message, and the sources you already have keep working.",
  },
];

export default async function PricingPage() {
  const plans = await getPlans();
  return (
    <>
      <PageIntro title="Pricing">
        <p>
          Plans are priced by AI replies per month, in US dollars. Every plan has a hard cap, so the bill is the same
          every month.
        </p>
      </PageIntro>

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8 sm:pb-24">
        {plans ? <PlanCards plans={plans} /> : <PlansUnavailable />}
      </div>

      <Section
        id="cap"
        title="How the hard cap works"
        intro="When you reach your plan's replies for the month, the agent stops answering and the widget shows a contact form instead. Messages from that form reach your inbox like any other handoff. Nothing goes dark, and there is no surprise overage."
      >
        <h3 className="text-lg text-ink">Questions</h3>
        <div className="mt-4 flex max-w-3xl flex-col divide-y divide-line border-y border-line">
          {faq.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-md font-medium text-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <span aria-hidden="true" className="text-xl leading-none text-ink-muted group-open:rotate-45 motion-safe:transition-transform">
                  +
                </span>
              </summary>
              <p className="mt-3 text-base text-ink-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}
