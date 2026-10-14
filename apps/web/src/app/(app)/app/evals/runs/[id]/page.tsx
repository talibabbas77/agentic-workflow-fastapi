import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsDetailSkeleton } from "@/components/evals/evals-skeleton";
import { RunDetail } from "@/components/evals/run-detail";
import { getEvalRun, getMe } from "@/lib/api/server";

export const metadata: Metadata = { title: "Eval run" };

export default function EvalRunPage({ params }: PageProps<"/app/evals/runs/[id]">) {
  return (
    <Suspense fallback={<EvalsDetailSkeleton label="Loading the run" />}>
      <EvalRun params={params} />
    </Suspense>
  );
}

async function EvalRun({ params }: Pick<PageProps<"/app/evals/runs/[id]">, "params">) {
  const { id } = await params;
  const [me, detail] = await Promise.all([getMe(), getEvalRun(id)]);
  const role = me.active_tenant?.role;
  return <RunDetail key={detail.run.id} initial={detail} canManage={role === "owner" || role === "admin"} />;
}
