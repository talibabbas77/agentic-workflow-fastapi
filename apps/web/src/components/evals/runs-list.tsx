"use client";

import type { EvalRun } from "@docent/api-client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { EvalsIllustration } from "@/components/illustrations/illustrations";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { api, request } from "@/lib/api/browser";
import { formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";
import { ACTIVE_RUN, formatCost, formatPercent, RunStatusBadge } from "./eval-meta";

const cell = "px-3 py-3.5 max-md:p-0";

/** Every run of every set, newest first. */
export function RunsList({ initial }: { initial: EvalRun[] }) {
  const now = useNow();
  const [runs, setRuns] = useState(initial);
  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/evals/runs", { params: { query: {} } }));
    if (result.ok) setRuns(result.data);
  }, []);
  usePoll(
    runs.some((r) => ACTIVE_RUN.has(r.status)),
    refresh,
    3000,
  );

  if (runs.length === 0) {
    return (
      <EmptyState
        illustration={<EvalsIllustration />}
        title="No runs yet"
        action={
          <ButtonLink href="/app/evals" variant="secondary">
            Go to sets
          </ButtonLink>
        }
      >
        <p>Open a set and choose Run eval. Every approved case goes through the real agent, one at a time.</p>
      </EmptyState>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-left text-base max-md:block">
        <thead className="max-md:hidden">
          <tr className="border-b border-line text-sm text-ink-muted">
            <th scope="col" className="px-6 py-2.5 font-medium">
              Set
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Passed
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Wrong answers
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Escalation recall
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Cost
            </th>
            <th scope="col" className="px-6 py-2.5 font-medium">
              Started
            </th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-line align-middle transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-1.5 max-md:px-5 max-md:py-4"
            >
              <td className="px-6 py-3.5 max-md:w-full max-md:p-0">
                <Link
                  href={`/app/evals/runs/${run.id}`}
                  className="rounded-sm font-medium text-ink underline-offset-[3px] hover:underline"
                >
                  {run.set_name}
                </Link>
                <span className="block text-sm text-ink-muted tabular-nums">
                  {run.done_count} of {run.case_count} cases
                  {run.created_by ? `, by ${run.created_by}` : ""}
                </span>
              </td>
              <td className={cell}>
                <RunStatusBadge status={run.status} />
              </td>
              <td className={`${cell} text-right tabular-nums max-md:text-sm`}>
                {formatPercent(run.metrics?.pass_rate)}
                <span className="md:hidden"> passed</span>
              </td>
              <td className={`${cell} text-right tabular-nums max-md:text-sm`}>
                {formatPercent(run.metrics?.wrong_answer_rate, 1)}
                <span className="md:hidden"> wrong</span>
              </td>
              <td
                className={`${cell} text-right tabular-nums max-md:text-sm ${
                  run.metrics?.escalation_recall == null ? "max-md:hidden" : ""
                }`}
              >
                <span className="md:hidden">Escalation recall </span>
                {formatPercent(run.metrics?.escalation_recall)}
              </td>
              <td className={`${cell} text-right tabular-nums max-md:text-sm max-md:text-ink-muted`}>
                {formatCost(run.cost_micros)}
              </td>
              <td className="px-6 py-3.5 whitespace-nowrap text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                {formatRelative(run.created_at, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
