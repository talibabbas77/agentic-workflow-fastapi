"use client";

import type { ProductionMetrics } from "@docent/api-client";
import Link from "next/link";
import type { ReactNode } from "react";
import { reasonLabel } from "@/components/inbox/inbox-meta";
import { EvalsIllustration } from "@/components/illustrations/illustrations";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatCount, formatDate, plural } from "@/lib/format";
import { formatCost, formatMs, formatPercent } from "./eval-meta";
import { PERIODS } from "./periods";
import { StatGrid } from "./stat-grid";

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** How the agent does with real customers over a period, from widget traffic only. */
export function MetricsDashboard({ metrics }: { metrics: ProductionMetrics }) {
  const m = metrics;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-ink-muted">
          Widget conversations that started from {formatDate(m.start)} to {formatDate(m.end)}. Previews and evals are
          not counted.
        </p>
        <nav aria-label="Period" className="inline-flex shrink-0 self-start rounded-md border border-line-strong bg-surface-2 p-0.5">
          {PERIODS.map((days) => (
            <Link
              key={days}
              href={`/app/evals/metrics?days=${days}`}
              aria-current={m.days === days ? "page" : undefined}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm transition-colors duration-150",
                m.days === days ? "bg-surface font-medium text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {days} days
            </Link>
          ))}
        </nav>
      </div>

      {m.conversations === 0 ? (
        <EmptyState illustration={<EvalsIllustration />} title={`No customer conversations in the last ${m.days} days`}>
          <p>
            These numbers come from conversations in your widget. Install it from the Widgets page; chats in the preview
            do not count.
          </p>
        </EmptyState>
      ) : (
        <>
          <StatGrid
            label="Production metrics"
            stats={[
              {
                label: "Conversations",
                value: formatCount(m.conversations),
                note: `${formatCount(m.answers)} ${plural(m.answers, "answer")} given`,
              },
              {
                label: "Resolved automatically",
                value: formatPercent(m.auto_resolution_rate),
                note: `${formatCount(m.auto_resolved)} ended on a cited answer`,
              },
              {
                label: "Resolved, confirmed",
                value: formatPercent(m.confirmed_resolution_rate),
                note: `${formatCount(m.confirmed_resolved)} graded right in review`,
              },
              {
                label: "Wrong-answer rate",
                value: formatPercent(m.wrong_answer_rate, 1),
                note: `${formatCount(m.marked_wrong)} of ${formatCount(m.answers)} answers marked wrong`,
                warn: (m.wrong_answer_rate ?? 0) > 0.05,
                quiet: m.wrong_answer_rate === null,
              },
              {
                label: "Handoff rate",
                value: formatPercent(m.escalation_rate),
                note: `${formatCount(m.escalated)} ${plural(m.escalated, "conversation")} handed off`,
              },
              {
                label: "Answer latency",
                value: formatMs(m.latency_p50_ms),
                note: m.latency_p50_ms === null ? "No answers yet" : `p50; p95 ${formatMs(m.latency_p95_ms)}`,
                quiet: m.latency_p50_ms === null,
              },
              {
                label: "Model cost",
                value: formatCost(m.cost_micros),
                note: `${formatCost(m.cost_per_conversation_micros)} a conversation`,
              },
              {
                label: "Wrong in review",
                value: formatPercent(m.review_wrong_rate),
                note: `${formatCount(m.reviewed)} graded in this period`,
                quiet: m.review_wrong_rate === null,
              },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <DailyChart metrics={m} />
            <Card aria-labelledby="reasons-heading">
              <CardHeader>
                <CardTitle id="reasons-heading">Handoffs by reason</CardTitle>
                <CardDescription>Share of all conversations in the period.</CardDescription>
              </CardHeader>
              {m.reasons.length === 0 ? (
                <p className="px-6 py-6 text-base text-ink-muted">No handoffs in this period.</p>
              ) : (
                <ul className="flex flex-col gap-4 px-6 py-5">
                  {m.reasons.map((r) => (
                    <li key={r.reason} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-ink">{reasonLabel[r.reason]}</span>
                        <span className="text-ink-muted tabular-nums">
                          {formatCount(r.conversations)}, {formatPercent(r.rate)}
                        </span>
                      </div>
                      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(2, (r.rate ?? 0) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card aria-labelledby="definitions-heading">
            <CardHeader>
              <CardTitle id="definitions-heading">How these are counted</CardTitle>
            </CardHeader>
            <dl className="grid gap-x-8 gap-y-4 px-6 py-5 text-sm sm:grid-cols-2">
              <Definition term="Resolved automatically">
                Quiet for 30 minutes, no handoff, nothing marked wrong, and the agent&apos;s last answer cited a source or
                the customer&apos;s verified details.
              </Definition>
              <Definition term="Resolved, confirmed">
                A teammate graded the conversation right in the weekly review. The widget does not ask customers yet.
              </Definition>
              <Definition term="Wrong-answer rate">
                Answers marked wrong in the inbox or graded wrong in the review, out of every answer in the period.
              </Definition>
              <Definition term="Answer latency">
                The answer model&apos;s time per answer. Handoffs decided by rules take no model time.
              </Definition>
            </dl>
          </Card>
        </>
      )}
    </div>
  );
}

function Definition({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-medium text-ink">{term}</dt>
      <dd className="text-ink-muted">{children}</dd>
    </div>
  );
}

function DailyChart({ metrics }: { metrics: ProductionMetrics }) {
  const days = metrics.daily;
  const top = Math.max(1, ...days.map((d) => d.conversations));
  const busiest = days.reduce((best, d) => (d.conversations > best.conversations ? d : best), days[0]!);
  return (
    <Card aria-labelledby="daily-heading">
      <CardHeader>
        <CardTitle id="daily-heading">Conversations by day</CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-line-strong" /> Conversations
          </span>
          <span className="ml-4 inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-rust" /> Handed off
          </span>
        </CardDescription>
      </CardHeader>
      <div className="px-6 py-5">
        <div
          role="img"
          aria-label={`Busiest day ${dayFormat.format(new Date(busiest.day))} with ${busiest.conversations} conversations.`}
          className="flex h-40 items-end gap-px"
        >
          {days.map((d) => (
            <div
              key={d.day}
              title={`${dayFormat.format(new Date(d.day))}: ${d.conversations} conversations, ${d.escalated} handed off`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-[2px] bg-line-strong"
                style={{ height: `${(d.conversations / top) * 100}%` }}
              >
                <div className="w-full bg-rust" style={{ height: `${d.conversations ? (d.escalated / d.conversations) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-ink-muted tabular-nums">
          <span>{dayFormat.format(new Date(days[0]!.day))}</span>
          <span>{dayFormat.format(new Date(days.at(-1)!.day))}</span>
        </div>
        <table className="sr-only">
          <caption>Conversations and handoffs by day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Conversations</th>
              <th scope="col">Handed off</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => d.conversations > 0)
              .map((d) => (
                <tr key={d.day}>
                  <th scope="row">{dayFormat.format(new Date(d.day))}</th>
                  <td>{d.conversations}</td>
                  <td>{d.escalated}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
