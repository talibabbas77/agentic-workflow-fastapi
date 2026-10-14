import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";
import { CONTACT_EMAIL } from "@/lib/site";
import { bandPadding, container, Eyebrow } from "./section";

export type FaqItem = { question: string; answer: ReactNode };

export const faqReplies: FaqItem = {
  question: "What counts as an AI reply?",
  answer:
    "One message the agent writes to a customer: an answer, a clarifying question, or the message that hands the conversation to your team. The customer's own messages, replies to greetings and thanks, and the emails your team sends do not count.",
};

export const faqCap: FaqItem = {
  question: "What happens at the cap?",
  answer:
    "The widget shows a short message and a contact form for the rest of the month, and every message becomes a handoff in your inbox, so customers still reach your team. Owners and admins get an email at 80 percent, and owners again at the cap. You are never billed for overage.",
};

export const faqFiles: FaqItem = {
  question: "Which files can it read?",
  answer:
    "PDF, Word (.docx), Markdown, text, and HTML files up to 20 MB each. You can also point it at a single web page or at a sitemap of up to 200 pages, and re-sync a source when it changes.",
};

export const faqIdentified: FaqItem = {
  question: "How does identified mode work?",
  answer:
    "Your server signs a short-lived ES256 token for the logged-in customer, with their user id and the fields you allow, such as plan. The widget passes it to Docent, which checks the signature with your public key before it starts a session. Docent never reads your cookies or storage, and a name typed into the chat changes nothing.",
};

export const faqTraining: FaqItem = {
  question: "Is our data used to train models?",
  answer: "No. Your documents and your customers' conversations are never used to train models.",
};

export const faqLiveChat: FaqItem = {
  question: "Do you offer live chat?",
  answer:
    "Not in this version. When Docent hands a conversation over, it lands in your inbox with a summary, and your team replies by email. The customer gets the reply by email too.",
};

export const faqUnsure: FaqItem = {
  question: "What happens when the agent is not sure?",
  answer:
    "If no passage in your docs supports an answer, Docent does not guess. It says so and offers to pass the conversation to your team with a summary. If the passages only partly cover the question, it asks one clarifying question first, and offers a person if it is still unsure.",
};

export const faqChangePlan: FaqItem = {
  question: "Can I change plans later?",
  answer:
    "Yes. An upgrade takes effect right away and raises your cap for the current month. A downgrade takes effect at the end of the period.",
};

export const faqPages: FaqItem = {
  question: "What are pages of docs?",
  answer:
    "How much content you can teach the agent. At the limit, new sources are refused with a clear message, and the sources you already have keep working.",
};

/** Native <details> accordions: no script, keyboard friendly, searchable with find in page. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="flex flex-col border-t border-line">
      {items.map((item) => (
        <details key={item.question} className="mk-faq group border-b border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-md font-medium text-ink transition-colors duration-150 hover:text-ink-muted [&::-webkit-details-marker]:hidden">
            {item.question}
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink transition-[transform,background-color,border-color] duration-200 ease-out group-open:rotate-45 group-open:border-ink group-open:bg-ink group-open:text-paper"
            >
              <PlusIcon className="size-3.5" weight="bold" />
            </span>
          </summary>
          <p className="max-w-[65ch] pb-6 text-base text-ink-muted">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** The questions band: the header on the left, the accordion on the right. */
export function FaqSection({ items, intro }: { items: FaqItem[]; intro: ReactNode }) {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-16 border-t border-line">
      <div className={cn(container, bandPadding, "grid gap-12 lg:grid-cols-12")}>
        <div className="mk-reveal flex flex-col gap-4 lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
          <Eyebrow>Questions</Eyebrow>
          <h2 id="faq-heading" className="text-2xl text-ink sm:text-3xl">
            Common questions
          </h2>
          <p className="max-w-[44ch] text-md text-ink-muted">
            {intro} For anything else, write to <TextLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</TextLink>.
            A person reads every message.
          </p>
        </div>
        <div className="mk-reveal lg:col-span-7">
          <Faq items={items} />
        </div>
      </div>
    </section>
  );
}
