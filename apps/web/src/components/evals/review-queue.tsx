"use client";

import type { ReviewQueue as Queue } from "@docent/api-client";
import { CaretRightIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EvalsIllustration } from "@/components/illustrations/illustrations";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select } from "@/components/ui/select";
import { formatCount } from "@/lib/format";

const weekFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function weekLabel(weekStart: string, current: boolean) {
  const label = `Week of ${weekFormat.format(new Date(weekStart))}`;
  return current ? `${label} (this week)` : label;
}

/** A week's sample of answered conversations, each to grade right or wrong. */
export function ReviewQueue({ queue }: { queue: Queue }) {
  const router = useRouter();
  const { counts } = queue;
  const thisWeek = queue.weeks[0]?.week_start;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <p className="text-base text-ink-muted">
            Each week, up to {queue.sample_size} conversations your agent answered are picked at random for a person to
            read. A wrong grade marks the answer as wrong, so it counts in your wrong-answer rate.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-64">
          <Select
            aria-label="Week"
            value={queue.week_start}
            onChange={(event) => router.push(`/app/evals/review?week=${event.target.value}`)}
          >
            {queue.weeks.map((w) => (
              <option key={w.week_start} value={w.week_start}>
                {weekLabel(w.week_start, w.week_start === thisWeek)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {queue.items.length === 0 ? (
        <EmptyState illustration={<EvalsIllustration />} title="Nothing to review this week">
          <p>
            The queue fills from widget conversations the agent answered in the last 7 days. Once customers chat with
            your widget, a sample shows up here.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 rounded-md border border-line bg-surface px-5 py-4">
            <p className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span className="font-medium text-ink tabular-nums">
                {formatCount(counts.graded)} of {formatCount(counts.sampled)} graded
              </span>
              <span className="text-sm text-ink-muted tabular-nums">
                {formatCount(counts.right)} right, {formatCount(counts.wrong)} wrong
              </span>
            </p>
            <ProgressBar value={counts.graded} max={counts.sampled} label="Graded this week" />
          </div>
          <ol aria-label="Conversations to review" className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            {queue.items.map((item) => (
              <li key={item.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`/app/evals/review/${item.id}`}
                  className="group flex items-start gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface-2/60"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p dir="auto" className="line-clamp-2 text-base break-words text-ink">
                      {item.question ?? "No question"}
                    </p>
                    <p dir="auto" className="line-clamp-2 text-sm break-words text-ink-muted">
                      {item.answer}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      {item.grade === "right" ? (
                        <Badge tone="outline" className="gap-1 text-ink">
                          <CheckIcon aria-hidden="true" className="size-3" weight="bold" />
                          Right
                        </Badge>
                      ) : item.grade === "wrong" ? (
                        <Badge className="gap-1 bg-rust text-on-rust">
                          <XIcon aria-hidden="true" className="size-3" weight="bold" />
                          Wrong
                        </Badge>
                      ) : (
                        <Badge tone="accent">To grade</Badge>
                      )}
                      <span>{item.mode === "identified" ? "Signed-in customer" : "Anonymous visitor"}</span>
                      {item.escalated ? <span>Later handed off</span> : null}
                      {item.graded_by ? <span>Graded by {item.graded_by}</span> : null}
                    </p>
                  </div>
                  <CaretRightIcon
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-ink-subtle transition-colors duration-150 group-hover:text-ink"
                  />
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
