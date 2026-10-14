"use client";

import type { EvalCaseChange, EvalComparison, EvalMetricDelta, EvalRun } from "@docent/api-client";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { EvalsIllustration } from "@/components/illustrations/illustrations";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { formatCost, formatMs, formatPercent } from "./eval-meta";
import { ResultBody, ResultSummary } from "./result-view";

const RATE_KEYS = new Set(["pass_rate", "wrong_answer_rate", "escalation_recall", "answer_rate", "retrieval_recall_at_8"]);
const MS_KEYS = new Set(["latency_p50_ms", "latency_p95_ms"]);

function value(key: string, v: number | null) {
  if (RATE_KEYS.has(key)) return formatPercent(v);
  if (MS_KEYS.has(key)) return formatMs(v);
  return formatCost(v);
}

function delta(d: EvalMetricDelta) {
  if (d.delta === null) return "Not comparable";
  if (d.delta === 0) return "Same";
  const sign = d.delta > 0 ? "+" : "-";
  const size = Math.abs(d.delta);
  if (RATE_KEYS.has(d.key)) return `${sign}${(size * 100).toFixed(1)} points`;
  if (MS_KEYS.has(d.key)) return `${sign}${formatMs(size)}`;
  return `${sign}${formatCost(size)}`;
}

const changeLabel: Record<EvalCaseChange["change"], string> = {
  broke: "Broke",
  fixed: "Fixed",
  added: "New case",
  removed: "Not in the second run",
  unchanged: "Unchanged",
};

function runLabel(run: EvalRun) {
  const passed = run.metrics ? `, ${formatPercent(run.metrics.pass_rate)} passed` : "";
  return `${formatDate(run.created_at)} ${new Date(run.created_at).toISOString().slice(11, 16)} UTC${passed}`;
}

/**
 * Two runs of one set side by side: what moved in the numbers, which settings
 * differed, and every case that broke or got fixed, with the reason.
 */
export function CompareView({
  runs,
  a,
  b,
  comparison,
  error,
}: {
  runs: EvalRun[];
  a: string | null;
  b: string | null;
  comparison: EvalComparison | null;
  error: string | null;
}) {
  const router = useRouter();
  const finished = runs.filter((r) => r.status === "succeeded" || r.status === "canceled");
  const bySet = new Map<string, EvalRun[]>();
  for (const run of finished) bySet.set(run.set_name, [...(bySet.get(run.set_name) ?? []), run]);
  const setOfB = finished.find((r) => r.id === b)?.set_id;

  if (finished.length < 2) {
    return (
      <EmptyState illustration={<EvalsIllustration />} title="Nothing to compare yet">
        <p>Run a set twice, for example before and after you change an article, then compare the two runs here.</p>
      </EmptyState>
    );
  }

  function pick(which: "a" | "b", id: string) {
    const next = new URLSearchParams();
    const nextA = which === "a" ? id : a;
    const nextB = which === "b" ? id : b;
    if (nextA) next.set("a", nextA);
    if (nextB) next.set("b", nextB);
    router.push(`/app/evals/compare?${next.toString()}`);
  }

  const options = (exclude: string | null, onlySet?: string) =>
    [...bySet.entries()].map(([setName, setRuns]) => (
      <optgroup key={setName} label={setName}>
        {setRuns
          .filter((r) => r.id !== exclude && (!onlySet || r.set_id === onlySet))
          .map((r) => (
            <option key={r.id} value={r.id}>
              {runLabel(r)}
            </option>
          ))}
      </optgroup>
    ));

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Before" hint="The older run, usually.">
          <Select value={a ?? ""} onChange={(event) => pick("a", event.target.value)}>
            <option value="" disabled>
              Choose a run
            </option>
            {options(b, setOfB)}
          </Select>
        </Field>
        <Field label="After" hint="Runs of the same set only.">
          <Select value={b ?? ""} onChange={(event) => pick("b", event.target.value)}>
            <option value="" disabled>
              Choose a run
            </option>
            {options(a)}
          </Select>
        </Field>
      </div>

      {error ? <FormAlert>{error}</FormAlert> : null}

      {comparison ? (
        <>
          <Card aria-labelledby="numbers-heading">
            <CardHeader>
              <CardTitle id="numbers-heading">What moved</CardTitle>
              <CardDescription>
                {comparison.counts.broke} broke, {comparison.counts.fixed} fixed, {comparison.counts.unchanged}{" "}
                unchanged
                {comparison.counts.added ? `, ${comparison.counts.added} new` : ""}
                {comparison.counts.removed ? `, ${comparison.counts.removed} only in the first run` : ""}.
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-base">
                <thead>
                  <tr className="border-b border-line text-sm text-ink-muted">
                    <th scope="col" className="px-6 py-2.5 font-medium">
                      Metric
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Before
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      After
                    </th>
                    <th scope="col" className="px-6 py-2.5 text-right font-medium">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.metrics.map((d) => (
                    <tr key={d.key} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-6 py-3 font-normal whitespace-nowrap text-ink">
                        {d.label}
                      </th>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-ink-muted tabular-nums">
                        {value(d.key, d.a)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-ink tabular-nums">
                        {value(d.key, d.b)}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap tabular-nums">
                        <span className={cn(d.better === false ? "font-medium text-rust" : "text-ink")}>
                          {delta(d)}
                        </span>
                        {d.better !== null ? (
                          <span className="ml-2 text-sm text-ink-muted">{d.better ? "better" : "worse"}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card aria-labelledby="settings-heading">
            <CardHeader>
              <CardTitle id="settings-heading">Settings that changed</CardTitle>
              <CardDescription>
                The knowledge version moves whenever an article, a team answer, or the agent&apos;s settings change.
              </CardDescription>
            </CardHeader>
            {comparison.config.length === 0 ? (
              <p className="px-6 py-5 text-base text-ink-muted">
                Same models, prompts, retrieval settings, and knowledge. A difference comes from the model itself.
              </p>
            ) : (
              <dl className="flex flex-col">
                {comparison.config.map((c) => (
                  <div
                    key={c.key}
                    className="flex flex-col gap-1 border-b border-line px-6 py-3 text-sm last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
                  >
                    <dt className="w-48 shrink-0 text-ink-muted">{c.label}</dt>
                    <dd className="min-w-0 font-mono break-words text-ink">
                      {c.a ?? "Not recorded"} <span className="font-sans text-ink-muted">then</span>{" "}
                      {c.b ?? "Not recorded"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card aria-labelledby="changes-heading">
            <CardHeader>
              <CardTitle id="changes-heading">Cases</CardTitle>
              <CardDescription>Broken cases first. Open one to see both results.</CardDescription>
            </CardHeader>
            <ol aria-label="Case changes">
              {comparison.cases.map((change) => (
                <ChangeRow key={change.case_id ?? change.question} change={change} />
              ))}
            </ol>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ChangeRow({ change }: { change: EvalCaseChange }) {
  const tone =
    change.change === "broke"
      ? "border-transparent bg-rust text-on-rust"
      : change.change === "fixed"
        ? "border-ink text-ink"
        : "border-line-strong text-ink-muted";
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex list-none items-start gap-3 px-6 py-4 transition-colors duration-150 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
          <CaretRightIcon
            aria-hidden="true"
            className="mt-1 size-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-open:rotate-90"
            weight="bold"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
                  tone,
                )}
              >
                {changeLabel[change.change]}
              </span>
              <span dir="auto" className="min-w-0 text-base break-words text-ink">
                {change.question}
              </span>
            </p>
            {change.why.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
                {change.why.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </summary>
        <div className="grid gap-6 border-t border-line bg-paper/60 px-6 py-5 lg:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const result = change[side];
            return (
              <div key={side} className="flex min-w-0 flex-col gap-3">
                <h4 className="text-sm font-semibold text-ink">{side === "a" ? "Before" : "After"}</h4>
                {result ? (
                  <>
                    <ResultSummary result={result} />
                    <ResultBody result={result} />
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">Not in this run.</p>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </li>
  );
}
