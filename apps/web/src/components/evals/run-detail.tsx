"use client";

import type { EvalResult, EvalRunDetail, EvalRunMetrics } from "@docent/api-client";
import { ArrowLeftIcon, CaretRightIcon, StopIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatRelative, plural } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";
import { ACTIVE_RUN, formatCost, formatMs, formatPercent, PASSING, RunStatusBadge } from "./eval-meta";
import { ResultBody, ResultSummary } from "./result-view";
import { StatGrid, type Stat } from "./stat-grid";

type Filter = "all" | "failed" | "passed";

export function runStats(metrics: EvalRunMetrics): Stat[] {
  const failed = metrics.wrong + metrics.unsupported;
  return [
    {
      label: "Passed",
      value: formatPercent(metrics.pass_rate),
      note: `${metrics.correct + metrics.escalated_correctly} of ${metrics.scored} cases`,
    },
    {
      label: "Wrong-answer rate",
      value: formatPercent(metrics.wrong_answer_rate, 1),
      note: `${failed} wrong or unsupported`,
      warn: (metrics.wrong_answer_rate ?? 0) > 0.05,
    },
    {
      label: "Escalation recall",
      value: formatPercent(metrics.escalation_recall),
      note: metrics.escalation_recall === null ? "No case expects a handoff" : "Handoffs where one was expected",
      quiet: metrics.escalation_recall === null,
      warn: metrics.escalation_recall !== null && metrics.escalation_recall < 0.95,
    },
    {
      label: "Answer rate",
      value: formatPercent(metrics.answer_rate),
      note: metrics.answer_rate === null ? "No case expects an answer" : "Answers where one was expected",
      quiet: metrics.answer_rate === null,
    },
    {
      label: "Gold document in top 8",
      value: formatPercent(metrics.retrieval_recall_at_8),
      note: metrics.retrieval_recall_at_8 === null ? "No case names a gold document" : "Search found the right article",
      quiet: metrics.retrieval_recall_at_8 === null,
    },
    {
      label: "Latency",
      value: formatMs(metrics.latency_p50_ms),
      note: `p50; p95 ${formatMs(metrics.latency_p95_ms)}`,
    },
    {
      label: "Cost",
      value: formatCost(metrics.cost_micros),
      note: `${formatCost(metrics.cost_per_case_micros)} a case`,
    },
    {
      label: "Could not run",
      value: String(metrics.error),
      note: metrics.error > 0 ? "Left out of the rates" : "Every case ran",
      warn: metrics.error > 0,
    },
  ];
}

/** One run: progress while it goes, then its numbers and every case's result. */
export function RunDetail({ initial, canManage }: { initial: EvalRunDetail; canManage: boolean }) {
  const toast = useToast();
  const now = useNow();
  const [detail, setDetail] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [stopping, setStopping] = useState(false);
  const run = detail.run;
  const active = ACTIVE_RUN.has(run.status);

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/evals/runs/{run_id}", { params: { path: { run_id: run.id } } }));
    if (result.ok) setDetail(result.data);
  }, [run.id]);

  usePoll(active, refresh, 2000);

  async function stop() {
    setStopping(true);
    const result = await request(api.POST("/v1/evals/runs/{run_id}/cancel", { params: { path: { run_id: run.id } } }));
    setStopping(false);
    if (result.ok) {
      toast({ tone: "success", title: "Run stopped", description: "Cases already done keep their results." });
      await refresh();
    } else {
      toast({ tone: "error", title: "Could not stop the run", description: result.error.message });
    }
  }

  const passed = detail.results.filter((r) => PASSING.has(r.verdict));
  const failed = detail.results.filter((r) => !PASSING.has(r.verdict));
  const shown = filter === "passed" ? passed : filter === "failed" ? failed : detail.results;
  const config = run.config;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href={`/app/evals/sets/${run.set_id}`}
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          {run.set_name}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl text-ink">Run of {run.set_name}</h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
              <RunStatusBadge status={run.status} />
              <span className="tabular-nums">Started {formatRelative(run.created_at, now)}</span>
              {run.created_by ? <span>by {run.created_by}</span> : null}
              <span className="tabular-nums">
                {run.case_count} {plural(run.case_count, "case")}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && active ? (
              <Button
                variant="secondary"
                loading={stopping}
                onClick={stop}
                icon={<StopIcon aria-hidden="true" className="size-4" weight="fill" />}
              >
                Stop run
              </Button>
            ) : null}
            {!active ? (
              <ButtonLink href={`/app/evals/compare?b=${run.id}`} variant="secondary">
                Compare with another run
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </div>

      {active ? (
        <div role="status" className="flex flex-col gap-2.5 rounded-md border border-line-strong bg-surface px-4 py-3.5">
          <p className="flex items-center gap-2.5 text-base text-ink">
            <span aria-hidden="true" className="spinner text-xs text-rust" />
            {run.status === "queued"
              ? "Waiting for the worker to start this run."
              : `Running case ${Math.min(run.done_count + 1, run.case_count)} of ${run.case_count}. Each one goes through the real agent, one at a time.`}
          </p>
          <ProgressBar value={run.done_count} max={Math.max(run.case_count, 1)} label="Cases done" />
        </div>
      ) : null}
      {run.status === "failed" ? (
        <FormAlert>The run stopped with an error: {run.error ?? "unknown"}. Cases already done are below.</FormAlert>
      ) : null}

      {run.metrics ? <StatGrid label="Run results" stats={runStats(run.metrics)} /> : null}

      <Card aria-labelledby="results-heading">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle id="results-heading">Cases</CardTitle>
            <CardDescription>Open a case to see the reply, each check, the judge&apos;s reason, and what search found.</CardDescription>
          </div>
          <div role="group" aria-label="Show" className="inline-flex shrink-0 self-start rounded-md border border-line-strong bg-surface-2 p-0.5">
            {(
              [
                ["all", `All ${detail.results.length}`],
                ["failed", `Not passed ${failed.length}`],
                ["passed", `Passed ${passed.length}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm tabular-nums transition-colors duration-150",
                  filter === value ? "bg-surface font-medium text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        {shown.length === 0 ? (
          <p className="px-6 py-8 text-center text-base text-ink-muted">
            {detail.results.length === 0 ? "No case has finished yet." : "No cases here."}
          </p>
        ) : (
          <ol aria-label="Case results">
            {shown.map((result) => (
              <ResultRow key={result.id} result={result} />
            ))}
          </ol>
        )}
      </Card>

      <Card aria-labelledby="config-heading">
        <CardHeader>
          <CardTitle id="config-heading">Ran with</CardTitle>
          <CardDescription>Compare two runs to see which of these changed.</CardDescription>
        </CardHeader>
        <dl className="grid gap-x-6 gap-y-3 px-6 py-5 text-sm sm:grid-cols-2">
          {[
            ["Answer model", config.model],
            ["Judge model", config.judge_model],
            ["Answer prompt", config.answer_prompt],
            ["Triage prompt", config.triage_prompt],
            ["Judge prompt", config.judge_prompt],
            ["Embedding model", config.embedding_model],
            ["Sources sent to the model", config.sources],
            ["Evidence threshold", config.min_similarity],
            ["Knowledge version", config.knowledge_version],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-mono break-words text-ink">{value ?? "Not recorded"}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function ResultRow({ result }: { result: EvalResult }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex list-none items-start gap-3 px-6 py-4 transition-colors duration-150 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
          <CaretRightIcon
            aria-hidden="true"
            className="mt-1 size-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-open:rotate-90"
            weight="bold"
          />
          <ResultSummary
            result={result}
            extra={
              result.verdict === "error" ? (
                <span className="inline-flex items-center gap-1 text-rust">
                  <WarningCircleIcon aria-hidden="true" className="size-3.5" weight="bold" />
                  {result.judge_notes}
                </span>
              ) : null
            }
          />
        </summary>
        <div className="border-t border-line bg-paper/60 px-6 py-5 sm:pl-12">
          <ResultBody result={result} />
        </div>
      </details>
    </li>
  );
}
