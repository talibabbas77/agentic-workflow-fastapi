import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { PageIntro } from "./section";

/** Privacy and terms: a plain draft with a visible note that it is not final. */
export function LegalPage({ title, sections }: { title: string; sections: { title: string; body: string[] }[] }) {
  return (
    <>
      <PageIntro title={title}>
        <p className="inline-flex items-start gap-2 rounded-md border border-line-strong bg-surface px-4 py-3 text-base text-ink">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" />
          Draft, pending legal review. This page explains our intent in plain language and will change before launch.
        </p>
      </PageIntro>
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8 sm:pb-24">
        <div className="flex max-w-3xl flex-col gap-10">
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-3">
              <h2 className="text-xl text-ink">{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-md text-ink-muted">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
