import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Small pieces of the Docent widget, drawn in HTML for the marketing pages.
 * They follow the real widget's styles (apps/widget/src/frame/frame.css) and
 * hold only fictional example content.
 */

export function Bubble({
  from,
  children,
  className,
}: {
  from: "visitor" | "agent";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "max-w-[88%] rounded-lg border px-3.5 py-2.5 text-base text-ink",
        from === "visitor" ? "self-end border-surface-2 bg-surface-2" : "self-start border-line bg-surface",
        className,
      )}
    >
      <span className="sr-only">{from === "visitor" ? "Customer: " : "Docent: "}</span>
      {children}
    </p>
  );
}

/** Inline citation marker, like [1] in an answer. */
export function Ref({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn(
        "mx-0.5 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-[5px] border border-line-strong bg-paper px-1 align-[2px] text-[0.6875rem] leading-none font-semibold text-ink-muted tabular-nums",
        className,
      )}
    >
      <span className="sr-only">source </span>
      {n}
    </span>
  );
}

/** The source chip under an answer: a number and the heading path of the passage. */
export function SourceChip({ n, children, className }: { n: number; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 self-start rounded-md border border-line py-1 pr-2.5 pl-1 text-sm text-ink-muted",
        className,
      )}
    >
      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-surface-2 px-1 text-[0.6875rem] font-semibold text-ink tabular-nums">
        <span className="sr-only">Source </span>
        {n}
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Three pulsing dots while the agent writes. */
export function TypingDots({ label = "Docent is writing" }: { label?: string }) {
  return (
    <span className="mk-dots inline-flex items-center gap-[3px] rounded-lg border border-line bg-surface px-3.5 py-3.5">
      <i />
      <i />
      <i />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** "Example" tag for any fictional company or person. */
export function ExampleTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-line-strong px-1.5 text-xs font-medium text-ink-muted",
        className,
      )}
    >
      Example
    </span>
  );
}
