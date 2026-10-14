import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsListSkeleton } from "@/components/evals/evals-skeleton";
import { RunsList } from "@/components/evals/runs-list";
import { getEvalRuns } from "@/lib/api/server";

export const metadata: Metadata = { title: "Eval runs" };

export default function EvalRunsPage() {
  return (
    <Suspense fallback={<EvalsListSkeleton label="Loading runs" rows={5} />}>
      <Runs />
    </Suspense>
  );
}

async function Runs() {
  return <RunsList initial={await getEvalRuns()} />;
}
