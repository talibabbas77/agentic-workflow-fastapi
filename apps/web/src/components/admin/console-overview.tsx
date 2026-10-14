"use client";

import type { AdminAnomaly, AdminOverview, AdminPlanStateCount } from "@docent/api-client";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatCount, formatMicros, formatPercent, formatPerReply, plural } from "@/lib/format";
import { PrivacyNote, StatTile } from "./bits";
import { planName, planOptions, stateOptions } from "./labels";
import { queryHref } from "./query";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

export function ConsoleOverview({ data }: { data: AdminOverview }) {
  const month = monthFormat.format(new Date(data.period_start));
  const median = data.median_cost_per_reply_micros;
  const margin = data.gross_margin;
  const paying = data.paying_workspaces;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <PageHeader
          title="Overview"
          description={`Every workspace on Docent, and what ${month} has brought in and cost so far.`}
        />
        <PrivacyNote />
      </div>

      <section aria-labelledby="figures-heading" className="flex flex-col gap-3">
        <h2 id="figures-heading" className="sr-only">
          Figures for {month}
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label="Monthly recurring revenue"
            value={formatMicros(data.mrr_micros)}
            note={`${formatCount(paying)} active Stripe ${plural(paying, "subscription")}`}
          />
          <StatTile
            label={`Model cost in ${month}`}
            value={formatMicros(data.cost_this_month_micros)}
            note="Every model call, from usage events"
          />
          <StatTile
            label="Gross margin"
            value={margin === null ? "No revenue" : formatPercent(margin)}
            note={margin === null ? "Nothing is paid through Stripe yet." : "Revenue less model cost, this month"}
            warn={margin !== null && margin < 0}
          />
          <StatTile
            label={`AI replies in ${month}`}
            value={formatCount(data.replies_this_month)}
            note={median === null ? "No replies yet this month" : `Median cost per reply ${formatPerReply(median)}`}
          />
          <StatTile
            label="Workspaces"
            value={formatCount(data.workspaces)}
            note={`${formatCount(paying)} paying through Stripe`}
          />
          <StatTile
            label="Signups, last 30 days"
            value={formatCount(data.new_workspaces_30d)}
            note={`New workspaces. ${formatCount(data.new_accounts_30d)} new ${plural(data.new_accounts_30d, "account")}.`}
          />
        </dl>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PlanStateTable counts={data.by_plan_state} total={data.workspaces} />
        <Anomalies anomalies={data.anomalies} median={median} />
      </div>
    </div>
  );
}

/** Workspaces by plan and status. Each count opens the list filtered to it. */
function PlanStateTable({ counts, total }: { counts: AdminPlanStateCount[]; total: number }) {
  const states = stateOptions.filter(([state]) => counts.some((c) => c.state === state));
  const count = (plan: string | null, state: string | null) =>
    counts
      .filter((c) => (plan === null || c.plan_id === plan) && (state === null || c.state === state))
      .reduce((sum, c) => sum + c.count, 0);
  const cell = "px-3 py-2.5 text-right tabular-nums";
  const first = "sticky left-0 bg-surface py-2.5 pr-3 pl-4 whitespace-nowrap sm:pl-6";

  return (
    <Card aria-labelledby="plans-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="plans-heading">Workspaces by plan and status</CardTitle>
        <CardDescription>Select a count to see those workspaces.</CardDescription>
      </CardHeader>
      {total === 0 ? (
        <p className="px-6 py-6 text-base text-ink-muted">No workspaces yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-b-md">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm text-ink-muted">
                <th scope="col" className={`${first} font-medium`}>
                  Plan
                </th>
                {states.map(([state, label]) => (
                  <th key={state} scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                    {label}
                  </th>
                ))}
                <th scope="col" className="px-6 py-2.5 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {planOptions.map(([plan, label]) => (
                <tr key={plan} className="border-b border-line">
                  <th scope="row" className={`${first} font-medium text-ink`}>
                    {label}
                  </th>
                  {states.map(([state]) => (
                    <td key={state} className={cell}>
                      <Count n={count(plan, state)} href={queryHref("/admin/workspaces", { plan, status: state })} />
                    </td>
                  ))}
                  <td className={`${cell} pr-6 font-medium`}>
                    <Count n={count(plan, null)} href={queryHref("/admin/workspaces", { plan })} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className={`${first} font-medium text-ink`}>
                  All plans
                </th>
                {states.map(([state]) => (
                  <td key={state} className={`${cell} font-medium`}>
                    <Count n={count(null, state)} href={queryHref("/admin/workspaces", { status: state })} />
                  </td>
                ))}
                <td className={`${cell} pr-6 font-semibold`}>
                  <Count n={total} href="/admin/workspaces" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function Count({ n, href }: { n: number; href: string }) {
  if (n === 0) return <span className="text-ink-subtle">0</span>;
  return (
    <Link href={href} className="rounded-sm text-ink underline-offset-[3px] hover:text-rust hover:underline">
      {formatCount(n)}
    </Link>
  );
}

function Anomalies({ anomalies, median }: { anomalies: AdminAnomaly[]; median: number | null }) {
  return (
    <Card aria-labelledby="anomalies-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="anomalies-heading">Cost per reply anomalies</CardTitle>
        <CardDescription>
          Workspaces whose cost per reply this month is more than 3 times the median
          {median === null ? "" : ` (${formatPerReply(median)})`}. Prompt abuse or a runaway loop looks like this.
        </CardDescription>
      </CardHeader>
      {anomalies.length === 0 ? (
        <p className="flex items-start gap-3 px-6 py-6 text-base text-ink-muted">
          <CheckCircleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-subtle" />
          {median === null
            ? "No workspace has replies this month yet."
            : median === 0
              ? "Every reply this month cost nothing, so there is no median to compare against."
              : "No workspace costs more than 3 times the median per reply this month."}
        </p>
      ) : (
        <ul>
          {anomalies.map((a) => (
            <li
              key={a.tenant_id}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-line px-6 py-3.5 last:border-b-0"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" weight="bold" />
                <div className="flex min-w-0 flex-col">
                  <Link
                    prefetch={false}
                    href={`/admin/workspaces/${a.tenant_id}`}
                    className="truncate rounded-sm font-medium text-ink underline-offset-[3px] hover:underline"
                  >
                    {a.name}
                  </Link>
                  <span className="text-sm text-ink-muted">
                    {planName(a.plan_id)}, {formatCount(a.replies_used)} {plural(a.replies_used, "reply", "replies")},{" "}
                    {formatMicros(a.cost_micros)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col pl-7 sm:items-end sm:pl-0 sm:text-right">
                <span className="font-medium text-ink tabular-nums">{formatPerReply(a.cost_per_reply_micros)} a reply</span>
                <span className="text-sm text-ink-muted tabular-nums">
                  {a.times_median.toFixed(1)} times the median
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
