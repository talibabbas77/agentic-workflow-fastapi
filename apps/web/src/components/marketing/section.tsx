import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Content width and gutters, the same as the header on every marketing page. */
export const container = "mx-auto w-full max-w-6xl px-4 sm:px-8";

/** The one vertical rhythm for page bands. */
export const bandPadding = "py-20 sm:py-24 lg:py-28";

/** A short label above a heading, marked with the brand ribbon. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-2 text-sm font-medium text-ink-muted", className)}>
      <span aria-hidden="true" className="mk-ribbon h-3 w-2 shrink-0" />
      {children}
    </p>
  );
}

/** Eyebrow, heading, and intro: the header pattern every section uses. */
export function SectionHeader({
  id,
  eyebrow,
  title,
  intro,
  className,
}: {
  id: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mk-reveal flex max-w-2xl flex-col gap-4", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={`${id}-heading`} className="text-2xl text-ink sm:text-3xl">
        {title}
      </h2>
      {intro ? <div className="max-w-[65ch] text-md text-ink-muted">{intro}</div> : null}
    </div>
  );
}

/** One page band: the same width, gutters, and rhythm everywhere on the marketing site. */
export function Section({
  id,
  eyebrow,
  title,
  intro,
  aside,
  children,
  className,
}: {
  id: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  /** Shown beside the header on wide screens, for example a link. */
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn("scroll-mt-16 border-t border-line", className)}>
      <div className={cn(container, bandPadding)}>
        {aside ? (
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <SectionHeader id={id} eyebrow={eyebrow} title={title} intro={intro} />
            <div className="shrink-0">{aside}</div>
          </div>
        ) : (
          <SectionHeader id={id} eyebrow={eyebrow} title={title} intro={intro} />
        )}
        {children ? <div className="mt-12 sm:mt-14">{children}</div> : null}
      </div>
    </section>
  );
}

/** The page title band at the top of each marketing page. */
export function PageIntro({
  title,
  eyebrow,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn(container, "pt-16 pb-12 sm:pt-24 sm:pb-16")}>
      <div className="flex max-w-3xl flex-col gap-4">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="text-3xl text-ink sm:text-4xl">{title}</h1>
        <div className="max-w-[65ch] text-lg text-ink-muted">{children}</div>
      </div>
    </div>
  );
}
