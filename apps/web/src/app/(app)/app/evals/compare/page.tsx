import type { EvalRun } from "@docent/api-client";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareView } from "@/components/evals/compare-view";
import { EvalsDetailSkeleton } from "@/components/evals/evals-skeleton";
import { getComparison, getEvalRuns } from "@/lib/api/server";

export const metadata: Metadata = { title: "Compare runs" };

export default function ComparePage({ searchParams }: PageProps<"/app/evals/compare">) {
  return (
    <Suspense fallback={<EvalsDetailSkeleton label="Loading the comparison" />}>
      <Compare searchParams={searchParams} />
    </Suspense>
  );
}

const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : null);

/** The run before `run` in the same set, among finished runs (newest first). */
function previous(runs: EvalRun[], run: EvalRun | undefined) {
  if (!run) return undefined;
  return runs.find((r) => r.set_id === run.set_id && r.created_at < run.created_at);
}

async function Compare({ searchParams }: Pick<PageProps<"/app/evals/compare">, "searchParams">) {
  const params = await searchParams;
  const runs = await getEvalRuns();
  const finished = runs.filter((r) => r.status === "succeeded" || r.status === "canceled");
  // Default to the latest run and the one before it in the same set.
  const b = one(params.b) ?? finished[0]?.id ?? null;
  const a = one(params.a) ?? previous(finished, finished.find((r) => r.id === b))?.id ?? null;
  const result = a && b ? await getComparison(a, b) : null;
  return (
    <CompareView
      runs={runs}
      a={a}
      b={b}
      comparison={result?.ok ? result.data : null}
      error={result && !result.ok ? result.error.message : null}
    />
  );
}
