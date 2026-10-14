import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsDetailSkeleton } from "@/components/evals/evals-skeleton";
import { SetDetail } from "@/components/evals/set-detail";
import { getEvalDocuments, getEvalSet, getMe } from "@/lib/api/server";

export const metadata: Metadata = { title: "Eval set" };

export default function EvalSetPage({ params }: PageProps<"/app/evals/sets/[id]">) {
  return (
    <Suspense fallback={<EvalsDetailSkeleton label="Loading the set" />}>
      <EvalSet params={params} />
    </Suspense>
  );
}

async function EvalSet({ params }: Pick<PageProps<"/app/evals/sets/[id]">, "params">) {
  const { id } = await params;
  const [me, detail, documents] = await Promise.all([getMe(), getEvalSet(id), getEvalDocuments()]);
  const role = me.active_tenant?.role;
  return (
    <SetDetail
      key={detail.set.id}
      initial={detail}
      documents={documents}
      canManage={role === "owner" || role === "admin"}
    />
  );
}
