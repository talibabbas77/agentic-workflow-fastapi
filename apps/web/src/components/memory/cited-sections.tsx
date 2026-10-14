import type { CitedSection } from "@docent/api-client";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Fragment, type Ref } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, plural } from "@/lib/format";

/** The ten sections the agent cited most in the last 30 days. */
export function CitedSections({ sections, ref }: { sections: CitedSection[]; ref?: Ref<HTMLElement> }) {
  const most = Math.max(1, ...sections.map((section) => section.citations));
  return (
    <Card ref={ref} tabIndex={-1} aria-labelledby="cited-heading" className="scroll-mt-20 outline-offset-4">
      <CardHeader className="gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <CardTitle id="cited-heading">Most cited sections</CardTitle>
        <CardDescription className="text-sm">What the agent answered from most in the last 30 days.</CardDescription>
      </CardHeader>
      {sections.length === 0 ? (
        <p className="px-6 py-10 text-center text-base text-ink-muted">
          Nothing cited in the last 30 days. When the agent answers from your sources, the sections it cites most show
          here.
        </p>
      ) : (
        <ol>
          {sections.map((section, index) => {
            // The heading path starts with the document title, which is already shown above it.
            const trail = section.heading_path
              .split(" > ")
              .filter((part, i) => part && !(i === 0 && part === section.document_title));
            return (
              <li
                key={`${section.document_title}-${section.heading_path}`}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-b border-line px-6 py-3.5 last:border-b-0 sm:grid-cols-[1.25rem_minmax(0,1fr)_9rem]"
              >
                <span className="pt-px text-sm text-ink-muted tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate font-medium text-ink">{section.document_title}</p>
                  {trail.length > 0 ? (
                    <p className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
                      {trail.map((part, i) => (
                        <Fragment key={i}>
                          {i > 0 ? <CaretRightIcon aria-hidden="true" className="size-3 text-ink-subtle" /> : null}
                          <span className="break-words">{part}</span>
                        </Fragment>
                      ))}
                    </p>
                  ) : null}
                </div>
                <div className="col-start-2 flex flex-col gap-1.5 sm:col-start-3 sm:items-end">
                  <span className="text-sm text-ink tabular-nums">
                    {formatCount(section.citations)} {plural(section.citations, "citation")}
                  </span>
                  <span aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-ink-muted"
                      style={{ width: `${(section.citations / most) * 100}%` }}
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
