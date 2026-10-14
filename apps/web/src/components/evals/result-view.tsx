"use client";

import type { EvalResult } from "@docent/api-client";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { reasonLabel } from "@/components/inbox/inbox-meta";
import { cn } from "@/lib/cn";
import { checkLabel, expectedLabel, formatCost, formatMs, replyLabel, VerdictBadge } from "./eval-meta";

/** What happened, in one line: "Should hand off. Answered." */
export function outcomeLine(result: EvalResult) {
  const output = result.output;
  let got = output.type ? replyLabel[output.type] : "Did not run";
  if (output.type === "escalate" && output.reason && output.reason in reasonLabel) {
    got += `: ${reasonLabel[output.reason as keyof typeof reasonLabel].toLowerCase()}`;
  }
  return `${expectedLabel[result.expected]}. ${got}.`;
}

/** The question, its verdict, and what happened. */
export function ResultSummary({ result, extra }: { result: EvalResult; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p dir="auto" className="text-base break-words text-ink">
        {result.question}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <VerdictBadge verdict={result.verdict} />
        <span>{outcomeLine(result)}</span>
        {extra}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-ink">{title}</h4>
      {children}
    </div>
  );
}

/** Everything about one result: the reply, the checks, the judge, and what search found. */
export function ResultBody({ result }: { result: EvalResult }) {
  const { output, case: snapshot } = result;
  return (
    <div className="flex flex-col gap-5">
      {snapshot.history.length > 0 || snapshot.identity !== null ? (
        <Section title="Asked as">
          <p className="text-sm text-ink-muted">
            {snapshot.identity === null ? (
              "An anonymous visitor"
            ) : (
              <>
                A signed-in customer
                {Object.keys(snapshot.identity).length > 0 ? (
                  <span className="font-mono text-ink">
                    {" "}
                    {Object.entries(snapshot.identity)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
                  </span>
                ) : null}
              </>
            )}
            {snapshot.history.length > 0 ? `, after ${snapshot.history.length} earlier turns` : null}
          </p>
        </Section>
      ) : null}

      <Section title="Reply">
        {output.content ? (
          <p
            dir="auto"
            className="rounded-md border border-line bg-paper px-3.5 py-2.5 text-base break-words whitespace-pre-wrap text-ink"
          >
            {output.content}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No reply.</p>
        )}
        {output.citations.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-ink-muted">
            {output.citations.map((c) => (
              <li key={c.marker}>
                <span className="font-mono text-ink">[{c.marker}]</span> {c.heading_path || c.document_title}
              </li>
            ))}
          </ul>
        ) : null}
        {snapshot.reference_answer ? (
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">Reference:</span> {snapshot.reference_answer}
          </p>
        ) : null}
      </Section>

      {result.checks.length > 0 ? (
        <Section title="Checks">
          <ul className="flex flex-col gap-1.5">
            {result.checks.map((check) => (
              <li key={check.name} className="flex items-start gap-2 text-sm">
                {check.passed ? (
                  <CheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ink" weight="bold" />
                ) : (
                  <XIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-rust" weight="bold" />
                )}
                <span className="sr-only">{check.passed ? "Passed: " : "Failed: "}</span>
                <span className="font-medium text-ink">{checkLabel[check.name]}</span>
                <span className="text-ink-muted">{check.detail}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {result.judge_notes ? (
        <Section title={result.judge_verdict ? "Judge" : "Note"}>
          <p className="text-sm text-ink-muted">
            {result.judge_verdict ? (
              <span className="font-medium text-ink">
                {result.judge_verdict === "correct"
                  ? "Correct. "
                  : result.judge_verdict === "wrong"
                    ? "Wrong. "
                    : "Not backed by the cited sources. "}
              </span>
            ) : null}
            {result.judge_notes}
          </p>
        </Section>
      ) : null}

      {result.retrieved.length > 0 ? (
        <Section title="What search found">
          <ol className="flex flex-col gap-1 text-sm">
            {result.retrieved.map((hit) => (
              <li key={hit.rank} className={cn("flex gap-2", hit.gold ? "text-ink" : "text-ink-muted")}>
                <span className="w-5 shrink-0 text-right tabular-nums">{hit.rank}.</span>
                <span className="min-w-0 flex-1 break-words">
                  {hit.heading_path || hit.document_title}
                  {hit.gold ? <span className="ml-1.5 font-medium text-rust">Gold</span> : null}
                </span>
                {hit.similarity !== null ? (
                  <span className="shrink-0 tabular-nums">{hit.similarity.toFixed(2)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted tabular-nums">
        <span>Took {formatMs(result.latency_ms)}</span>
        <span>Cost {formatCost(result.cost_micros)}</span>
        <span>
          {result.tokens_in.toLocaleString("en-US")} tokens in, {result.tokens_out.toLocaleString("en-US")} out
        </span>
      </p>
    </div>
  );
}
