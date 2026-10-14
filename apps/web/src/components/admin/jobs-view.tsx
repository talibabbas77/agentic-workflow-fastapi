"use client";

import type { AdminDeadJob, AdminJobs } from "@docent/api-client";
import { ArrowClockwiseIcon, CheckCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatCount, formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { StatTile } from "./bits";

const STATUSES = ["queued", "running", "succeeded", "failed", "dead"] as const;
const statusLabel: Record<(typeof STATUSES)[number], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  dead: "Dead",
};

/** A job that has waited this long while due means the worker is not keeping up, or not awake. */
const SLOW_SECONDS = 5 * 60;

export function JobsView({ initial }: { initial: AdminJobs }) {
  const toast = useToast();
  const [jobs, setJobs] = useState(initial);
  const [confirm, setConfirm] = useState<AdminDeadJob | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oldest = jobs.oldest_ready_seconds;

  async function retry(job: AdminDeadJob) {
    setPending(true);
    setError(null);
    const result = await request(
      api.POST("/v1/admin/jobs/{job_id}/retry", { params: { path: { job_id: job.id } } }),
    );
    setPending(false);
    if (!result.ok) return setError(result.error.message);
    setJobs(result.data);
    setConfirm(null);
    toast({
      tone: "success",
      title: `Job ${job.id} is queued again`,
      description: "It has a fresh set of attempts, and the worker was woken to run it.",
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Jobs"
        description="The Postgres job queue: what is waiting, what is running, and what gave up."
      />

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Due now" value={formatCount(jobs.ready)} note="Queued and ready to run" />
        <StatTile
          label="Longest wait"
          value={oldest === null ? "None" : formatDuration(oldest)}
          note={
            oldest === null
              ? "Nothing is waiting"
              : oldest > SLOW_SECONDS
                ? "Is the worker running?"
                : "For the oldest due job"
          }
          warn={oldest !== null && oldest > SLOW_SECONDS}
        />
        <StatTile label="Scheduled" value={formatCount(jobs.scheduled)} note="Retries and later work" />
        <StatTile label="Running" value={formatCount(jobs.running)} note="Claimed by a worker" />
        <StatTile
          label="Dead"
          value={formatCount(jobs.dead)}
          note={jobs.dead > 0 ? "Out of attempts" : "None"}
          warn={jobs.dead > 0}
        />
      </dl>

      <Counts jobs={jobs} />

      <Card aria-labelledby="dead-heading" className="min-w-0">
        <CardHeader>
          <CardTitle id="dead-heading">Dead jobs</CardTitle>
          <CardDescription>
            Jobs that failed every attempt, newest first. Fix the cause, then retry; the job runs again from its first
            attempt. Dead jobs are deleted after 30 days.
          </CardDescription>
        </CardHeader>
        {jobs.dead_jobs.length === 0 ? (
          <p className="flex items-center gap-3 px-6 py-6 text-base text-ink-muted">
            <CheckCircleIcon aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
            No dead jobs.
          </p>
        ) : (
          <ul>
            {jobs.dead_jobs.map((job) => (
              <DeadJob key={job.id} job={job} onRetry={() => setConfirm(job)} />
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
          setError(null);
        }}
        title="Retry this job?"
        description={
          confirm
            ? `${confirm.kind} job ${confirm.id}${confirm.workspace_name ? ` for ${confirm.workspace_name}` : ""} goes back in the queue with ${confirm.max_attempts} new attempts.`
            : ""
        }
      >
        <DialogBody className="flex flex-col gap-4">
          <p className="text-base text-ink-muted">
            Every job is built to be safe to run twice. If the cause is not fixed, it fails the same way again.
            {confirm?.tenant_id ? " The retry goes in the workspace's audit log with your name." : ""}
          </p>
          {error ? <FormAlert>{error}</FormAlert> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button loading={pending} onClick={() => confirm && retry(confirm)}>
            Retry job
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function Counts({ jobs }: { jobs: AdminJobs }) {
  const kinds = [...new Set(jobs.counts.map((c) => c.kind))].sort();
  const count = (kind: string, status: string) =>
    jobs.counts.find((c) => c.kind === kind && c.status === status)?.count ?? 0;
  return (
    <Card aria-labelledby="counts-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="counts-heading">Jobs by kind and status</CardTitle>
        <CardDescription>Every job still kept. Succeeded jobs are deleted after 7 days.</CardDescription>
      </CardHeader>
      {kinds.length === 0 ? (
        <p className="px-6 py-6 text-base text-ink-muted">The queue is empty.</p>
      ) : (
        <div className="overflow-x-auto rounded-b-md">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm text-ink-muted">
                <th scope="col" className="sticky left-0 bg-surface py-2.5 pr-3 pl-4 font-medium sm:pl-6">
                  Kind
                </th>
                {STATUSES.map((status) => (
                  <th key={status} scope="col" className="px-3 py-2.5 text-right font-medium last:pr-6">
                    {statusLabel[status]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kinds.map((kind) => (
                <tr key={kind} className="border-b border-line last:border-b-0">
                  <th scope="row" className="sticky left-0 bg-surface py-2.5 pr-3 pl-4 font-mono text-sm font-normal whitespace-nowrap text-ink sm:pl-6">
                    {kind}
                  </th>
                  {STATUSES.map((status) => {
                    const n = count(kind, status);
                    return (
                      <td key={status} className="px-3 py-2.5 text-right tabular-nums last:pr-6">
                        {n === 0 ? (
                          <span className="text-ink-subtle">0</span>
                        ) : (
                          <span className={status === "dead" ? "font-medium text-rust" : "text-ink"}>
                            {formatCount(n)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DeadJob({ job, onRetry }: { job: AdminDeadJob; onRetry: () => void }) {
  const now = useNow();
  return (
    <li className="flex flex-col gap-3 border-b border-line px-6 py-4 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm font-medium text-ink">{job.kind}</span>
          <span className="text-sm text-ink-muted tabular-nums">Job {job.id}</span>
          {job.workspace_name && job.tenant_id ? (
            <Link
              prefetch={false}
              href={`/admin/workspaces/${job.tenant_id}`}
              className="truncate rounded-sm text-sm text-ink underline-offset-[3px] hover:underline"
            >
              {job.workspace_name}
            </Link>
          ) : (
            <span className="text-sm text-ink-muted">No workspace</span>
          )}
        </div>
        {job.last_error ? (
          <p className="rounded-sm border border-line bg-surface-2 px-3 py-2 font-mono text-sm break-words whitespace-pre-wrap text-ink">
            {job.last_error.length > 600 ? `${job.last_error.slice(0, 600)}...` : job.last_error}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No error was recorded.</p>
        )}
        <p className="text-sm text-ink-muted">
          {job.attempts} of {job.max_attempts} attempts.{" "}
          {job.finished_at ? (
            <time dateTime={job.finished_at} title={formatDateTime(job.finished_at)}>
              Gave up {formatRelative(job.finished_at, now)}.
            </time>
          ) : null}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0 self-start"
        onClick={onRetry}
        icon={<ArrowClockwiseIcon aria-hidden="true" className="size-4" />}
      >
        Retry<span className="sr-only"> job {job.id}</span>
      </Button>
    </li>
  );
}
