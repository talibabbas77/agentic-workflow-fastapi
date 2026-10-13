import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One page band: the same width, gutters, and rhythm everywhere on the marketing site. */
export function Section({
  id,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn("border-t border-line", className)}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 id={`${id}-heading`} className="text-2xl text-ink sm:text-3xl">
            {title}
          </h2>
          {intro ? <div className="text-md text-ink-muted">{intro}</div> : null}
        </div>
        {children ? <div className="mt-10 sm:mt-12">{children}</div> : null}
      </div>
    </section>
  );
}

/** A framed panel for a workflow diagram. */
export function DiagramPanel({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-line bg-surface px-4 py-10 sm:px-8 sm:py-12">{children}</div>;
}

/** The page title band at the top of each marketing page. */
export function PageIntro({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
      <div className="flex max-w-3xl flex-col gap-4">
        <h1 className="text-3xl text-ink sm:text-4xl">{title}</h1>
        <div className="text-lg text-ink-muted">{children}</div>
      </div>
    </div>
  );
}
