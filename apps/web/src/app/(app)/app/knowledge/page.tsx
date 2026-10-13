import type { Metadata } from "next";
import { Suspense } from "react";
import { KnowledgeManager } from "@/components/knowledge/knowledge-manager";
import { KnowledgeSkeleton } from "@/components/knowledge/knowledge-skeleton";
import { TeachingFlow } from "@/components/workflow/teaching-flow";
import { getMe, getSources } from "@/lib/api/server";

export const metadata: Metadata = { title: "Knowledge" };

export default function KnowledgePage() {
  return (
    <Suspense fallback={<KnowledgeSkeleton />}>
      <Knowledge />
    </Suspense>
  );
}

async function Knowledge() {
  const [me, sources] = await Promise.all([getMe(), getSources()]);
  const role = me.active_tenant?.role;
  return (
    <KnowledgeManager
      initial={sources}
      canManage={role === "owner" || role === "admin"}
      teachingFlow={<TeachingFlow />}
    />
  );
}
