import type { Metadata } from "next";
import { Suspense } from "react";
import { EvalsListSkeleton } from "@/components/evals/evals-skeleton";
import { SetsManager } from "@/components/evals/sets-manager";
import { getEvalSets, getMe } from "@/lib/api/server";

export const metadata: Metadata = { title: "Evals" };

export default function EvalsPage() {
  return (
    <Suspense fallback={<EvalsListSkeleton label="Loading eval sets" />}>
      <Sets />
    </Suspense>
  );
}

async function Sets() {
  const [me, sets] = await Promise.all([getMe(), getEvalSets()]);
  const role = me.active_tenant?.role;
  return <SetsManager sets={sets} canManage={role === "owner" || role === "admin"} />;
}
