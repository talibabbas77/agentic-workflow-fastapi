import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceSkeleton } from "@/components/admin/console-skeleton";
import { WorkspaceDetail } from "@/components/admin/workspace-detail";
import { getAdminWorkspace } from "@/lib/api/server";

// A fixed title: reading the name here would open the workspace a second time,
// and each opening is written to its audit log.
export const metadata: Metadata = { title: "Workspace" };

export default function AdminWorkspacePage({ params }: PageProps<"/admin/workspaces/[id]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Workspace params={params} />
    </Suspense>
  );
}

async function Workspace({ params }: Pick<PageProps<"/admin/workspaces/[id]">, "params">) {
  const { id } = await params;
  const workspace = await getAdminWorkspace(id);
  return <WorkspaceDetail key={workspace.id} initial={workspace} />;
}
