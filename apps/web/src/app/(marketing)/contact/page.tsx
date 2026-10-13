import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/section";
import { TextLink } from "@/components/ui/text-link";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach the people behind Docent, including where to report a security issue.",
};

export default function ContactPage() {
  return (
    <>
      <PageIntro title="Contact">
        <p>A person reads every message. For questions about setup, start with the docs; they may answer it faster.</p>
      </PageIntro>
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8 sm:pb-24">
        <div className="flex max-w-3xl flex-col gap-6">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-3 self-start rounded-md border border-line bg-surface px-5 py-4 text-md font-medium text-ink transition-colors duration-150 hover:bg-surface-2"
          >
            <EnvelopeSimpleIcon aria-hidden="true" className="size-5 text-rust" />
            {CONTACT_EMAIL}
          </a>
          <ul className="flex flex-col gap-2 text-base text-ink-muted">
            <li>
              Setting up the widget or signing tokens: read the <TextLink href="/docs">install guide</TextLink>.
            </li>
            <li>
              Reporting a security issue: see <TextLink href="/security">security</TextLink>, then write to the address
              above with &quot;Security&quot; in the subject.
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
