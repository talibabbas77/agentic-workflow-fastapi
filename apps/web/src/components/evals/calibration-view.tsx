"use client";

import type { EvalCalibration, EvalLabel, EvalResult } from "@docent/api-client";
import { ArrowCounterClockwiseIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { EvalsIllustration } from "@/components/illustrations/illustrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatPercent } from "./eval-meta";

const judgeWords = { correct: "Correct", wrong: "Wrong", unsupported: "Not backed by sources" } as const;

/**
 * Judge calibration: label answers the judge graded, and see how often it agrees
 * with you. Its numbers are trusted at 85 percent agreement over 50 labels.
 */
export function CalibrationView({ initial, canManage }: { initial: EvalCalibration; canManage: boolean }) {
  const toast = useToast();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/evals/calibration"));
    if (result.ok) setData(result.data);
  }, []);

  async function label(result: EvalResult, value: EvalLabel | null) {
    setBusy(result.id);
    const saved = await request(
      api.PUT("/v1/evals/results/{result_id}/label", {
        params: { path: { result_id: result.id } },
        body: { label: value },
      }),
    );
    if (saved.ok) await refresh();
    else toast({ tone: "error", title: "Could not save the label", description: saved.error.message });
    setBusy(null);
  }

  const left = Math.max(0, data.target - data.labeled);
  const c = data.confusion;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card aria-labelledby="agreement-heading">
          <CardHeader>
            <CardTitle id="agreement-heading">Agreement with you</CardTitle>
            <CardDescription>How often the judge&apos;s verdict matches your label on the same answer.</CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            <p className="flex items-baseline gap-3">
              <span className="text-4xl font-semibold tracking-tight text-ink tabular-nums">
                {data.agreement === null ? "None yet" : formatPercent(data.agreement)}
              </span>
              <span className="text-sm text-ink-muted tabular-nums">
                {data.agreed} of {data.labeled} agree
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              <ProgressBar value={data.labeled} max={data.target} label="Labels toward the target" />
              <p className="text-sm text-ink-muted tabular-nums">
                {data.labeled} of {data.target} labels
              </p>
            </div>
            {data.trusted ? (
              <FormAlert tone="success">
                The judge agrees with you on {formatPercent(data.agreement)} of {data.labeled} answers. Its verdicts can
                be trusted.
              </FormAlert>
            ) : left > 0 ? (
              <FormAlert tone="info">
                Label {left} more {left === 1 ? "answer" : "answers"} to know whether to trust the judge. It needs{" "}
                {formatPercent(data.threshold)} agreement over {data.target}.
              </FormAlert>
            ) : (
              <FormAlert>
                Below the {formatPercent(data.threshold)} the judge needs. Read its reasons before trusting a run&apos;s
                wrong-answer rate, or try another judge model.
              </FormAlert>
            )}
          </div>
        </Card>

        <Card aria-labelledby="confusion-heading">
          <CardHeader>
            <CardTitle id="confusion-heading">Where you differ</CardTitle>
            <CardDescription>Faulted means the judge called the answer wrong or not backed by its sources.</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto px-6 py-5">
            <table className="w-full text-left text-base">
              <thead>
                <tr className="text-sm text-ink-muted">
                  <td />
                  <th scope="col" className="pb-2 text-right font-medium">
                    You: right
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    You: wrong
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-line">
                  <th scope="row" className="py-2.5 font-normal text-ink">
                    Judge: correct
                  </th>
                  <td className="py-2.5 text-right text-ink">{c.judge_correct_person_right}</td>
                  <td className="py-2.5 text-right font-medium text-rust">{c.judge_correct_person_wrong}</td>
                </tr>
                <tr className="border-t border-line">
                  <th scope="row" className="py-2.5 font-normal text-ink">
                    Judge: faulted
                  </th>
                  <td className="py-2.5 text-right font-medium text-rust">{c.judge_faulted_person_right}</td>
                  <td className="py-2.5 text-right text-ink">{c.judge_faulted_person_wrong}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-sm text-ink-muted">
              The rust numbers are disagreements. A judge that passes wrong answers hides problems; one that faults
              right answers makes runs look worse than they are.
            </p>
          </div>
        </Card>
      </div>

      <Card aria-labelledby="queue-heading">
        <CardHeader>
          <CardTitle id="queue-heading">Judged answers to label</CardTitle>
          <CardDescription>
            Read the question and the answer, then say whether it is right. The judge&apos;s call is shown so you can see
            what you are checking.
          </CardDescription>
        </CardHeader>
        {data.to_label.length === 0 ? (
          <div className="p-6">
            <EmptyState illustration={<EvalsIllustration />} title="Nothing waiting for a label">
              <p>
                Answers appear here once a run has judged them. <Link href="/app/evals" className="font-medium text-rust underline underline-offset-[3px]">Run a set</Link> to get more.
              </p>
            </EmptyState>
          </div>
        ) : (
          <ol aria-label="Answers to label">
            {data.to_label.map((result) => (
              <li key={result.id} className="flex flex-col gap-3 border-b border-line px-6 py-5 last:border-b-0">
                <p dir="auto" className="text-base font-medium break-words text-ink">
                  {result.question}
                </p>
                <p
                  dir="auto"
                  className="rounded-md border border-line bg-paper px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-ink"
                >
                  {result.output.content}
                </p>
                {result.case.reference_answer ? (
                  <p className="text-sm text-ink-muted">
                    <span className="font-medium text-ink">Reference:</span> {result.case.reference_answer}
                  </p>
                ) : null}
                <p className="text-sm text-ink-muted">
                  <span className="font-medium text-ink">
                    Judge: {result.judge_verdict ? judgeWords[result.judge_verdict] : "No verdict"}.
                  </span>{" "}
                  {result.judge_notes}
                </p>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      loading={busy === result.id}
                      onClick={() => void label(result, "right")}
                      icon={<CheckIcon aria-hidden="true" className="size-4" weight="bold" />}
                    >
                      Right
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void label(result, "wrong")}
                      icon={<XIcon aria-hidden="true" className="size-4" weight="bold" />}
                    >
                      Wrong
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {canManage ? null : (
          <p className="border-t border-line px-6 py-4 text-sm text-ink-muted">Owners and admins label answers.</p>
        )}
      </Card>

      {data.recent.length > 0 ? (
        <Card aria-labelledby="recent-heading">
          <CardHeader>
            <CardTitle id="recent-heading">Your latest labels</CardTitle>
          </CardHeader>
          <ol aria-label="Latest labels">
            {data.recent.map((result) => {
              const agrees = (result.judge_verdict === "correct") === (result.label === "right");
              return (
                <li key={result.id} className="flex items-start gap-3 border-b border-line px-6 py-3.5 last:border-b-0">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p dir="auto" className="line-clamp-2 text-base break-words text-ink">
                      {result.question}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <Badge tone={result.label === "wrong" ? "accent" : "outline"}>
                        You: {result.label === "right" ? "right" : "wrong"}
                      </Badge>
                      <span>Judge: {result.judge_verdict ? judgeWords[result.judge_verdict].toLowerCase() : "none"}</span>
                      <span className={agrees ? "text-ink-muted" : "font-medium text-rust"}>
                        {agrees ? "Agree" : "Disagree"}
                      </span>
                    </p>
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void label(result, null)}
                      icon={<ArrowCounterClockwiseIcon aria-hidden="true" className="size-4" />}
                    >
                      Clear
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
