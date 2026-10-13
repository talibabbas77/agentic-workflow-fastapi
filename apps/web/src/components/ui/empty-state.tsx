import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  illustration,
  title,
  children,
  action,
  className,
}: {
  illustration?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fade-in flex flex-col items-center rounded-md border border-line bg-surface px-6 py-14 text-center sm:py-20",
        className,
      )}
    >
      {illustration ? <div className="mb-6 text-ink">{illustration}</div> : null}
      <h2 className="font-serif text-xl text-ink">{title}</h2>
      {children ? (
        <div className="mt-2 flex max-w-md flex-col gap-2 text-base text-ink-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
