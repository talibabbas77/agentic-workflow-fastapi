"use client";

import type { EvalSet } from "@docent/api-client";
import { CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EvalsIllustration } from "@/components/illustrations/illustrations";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { formatCount, formatRelative, plural } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { formatPercent, RunStatusBadge } from "./eval-meta";
import { SetDialog } from "./set-dialog";

/** Every eval set, with its size and how its last run went. */
export function SetsManager({ sets, canManage }: { sets: EvalSet[]; canManage: boolean }) {
  const router = useRouter();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);

  const newSet = canManage ? (
    <Button
      onClick={() => {
        setDialogKey((n) => n + 1);
        setOpen(true);
      }}
      icon={<PlusIcon aria-hidden="true" className="size-4" />}
    >
      New set
    </Button>
  ) : null;

  const dialog = (
    <SetDialog
      key={dialogKey}
      open={open}
      onClose={() => setOpen(false)}
      onSaved={(created) => {
        setOpen(false);
        router.push(`/app/evals/sets/${created.id}`);
      }}
    />
  );

  if (sets.length === 0) {
    return (
      <>
        <EmptyState
          illustration={<EvalsIllustration />}
          title="No test sets yet"
          action={newSet ?? undefined}
        >
          <p>
            Save questions your customers ask with the outcome you expect: an answer, a handoff, or a clarifying
            question. Draft them from your help articles, or add them from the inbox.
          </p>
          <p>Each run sends every question through the real agent and checks what comes back.</p>
          {canManage ? null : <p>Owners and admins create sets.</p>}
        </EmptyState>
        {dialog}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-ink-muted">
          {formatCount(sets.length)} {plural(sets.length, "set")}. Runs use approved cases; drafts wait for you.
        </p>
        {newSet}
      </div>
      {canManage ? null : (
        <FormAlert tone="info">Owners and admins change sets and start runs. You can look at everything.</FormAlert>
      )}
      <ul aria-label="Eval sets" className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        {sets.map((set) => {
          const last = set.last_run;
          const drafting = set.drafting.status === "running";
          return (
            <li key={set.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/app/evals/sets/${set.id}`}
                className="group flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface-2/60"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-md font-medium text-ink">{set.name}</span>
                  {set.description ? (
                    <span className="line-clamp-1 text-sm text-ink-muted">{set.description}</span>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                    <span className="tabular-nums">
                      {formatCount(set.cases)} {plural(set.cases, "case")}
                    </span>
                    {set.drafts > 0 ? (
                      <span className="tabular-nums">
                        {formatCount(set.drafts)} {plural(set.drafts, "draft")} to review
                      </span>
                    ) : null}
                    <span className="text-ink tabular-nums sm:hidden">
                      {last?.status === "succeeded"
                        ? `${formatPercent(last.pass_rate)} passed, ${formatPercent(last.wrong_answer_rate)} wrong`
                        : last
                          ? null
                          : "Not run yet"}
                    </span>
                    {drafting ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="spinner text-[0.625rem] text-rust" />
                        Writing drafts: {set.drafting.written + set.drafting.skipped} of {set.drafting.requested}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 text-sm sm:flex">
                  {last ? (
                    <>
                      {last.status === "succeeded" ? (
                        <span className="text-ink tabular-nums">
                          {formatPercent(last.pass_rate)} passed
                          <span className="text-ink-muted">, {formatPercent(last.wrong_answer_rate)} wrong</span>
                        </span>
                      ) : (
                        <RunStatusBadge status={last.status} />
                      )}
                      <span className="text-ink-muted tabular-nums">
                        Last run {formatRelative(last.created_at, now)}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">Not run yet</span>
                  )}
                </div>
                <CaretRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-ink-subtle transition-colors duration-150 group-hover:text-ink"
                />
              </Link>
            </li>
          );
        })}
      </ul>
      {dialog}
    </div>
  );
}
