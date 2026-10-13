import type { Metadata } from "next";
import { Suspense } from "react";
import { SourceSkeleton } from "@/components/knowledge/knowledge-skeleton";
import { SourceDetailView } from "@/components/knowledge/source-detail";
import { getMe, getSource } from "@/lib/api/server";

export const metadata: Metadata = { title: "Knowledge source" };

export default function SourcePage({ params }: PageProps<"/app/knowledge/[sourceId]">) {
  return (
    <Suspense fallback={<SourceSkeleton />}>
      <Source params={params} />
    </Suspense>
  );
}

async function Source({ params }: Pick<PageProps<"/app/knowledge/[sourceId]">, "params">) {
  const { sourceId } = await params;
  const [me, detail] = await Promise.all([getMe(), getSource(sourceId)]);
  const role = me.active_tenant?.role;
  return <SourceDetailView initial={detail} canManage={role === "owner" || role === "admin"} />;
}
