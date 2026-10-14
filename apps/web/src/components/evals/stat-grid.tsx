import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Stat = { label: string; value: ReactNode; note?: ReactNode; warn?: boolean };

/** A row of numbers with a label and a short note under each. Two across on a phone. */
export function StatGrid({ stats, className, label }: { stats: Stat[]; className?: string; label: string }) {
  return (
    <dl
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4",
        className,
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-4 sm:px-5">
          <dt className="text-sm text-ink-muted">{stat.label}</dt>
          <dd className="flex flex-col gap-1">
            <span
              className={cn(
                "text-2xl font-semibold tracking-tight tabular-nums",
                stat.warn ? "text-rust" : "text-ink",
              )}
            >
              {stat.value}
            </span>
            {stat.note ? <span className="text-sm text-ink-muted">{stat.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
