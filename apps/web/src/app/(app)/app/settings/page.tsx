import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceForm } from "@/components/app/workspace-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { getTenant } from "@/lib/api/server";

export const metadata: Metadata = { title: "Workspace settings" };

export default function WorkspaceSettingsPage() {
  return (
    <Suspense
      fallback={
        <Loading className="max-w-2xl">
          <Skeleton className="h-80 w-full rounded-md" />
        </Loading>
      }
    >
      <WorkspaceSettings />
    </Suspense>
  );
}

async function WorkspaceSettings() {
  const tenant = await getTenant();
  const canEdit = tenant.your_role === "owner" || tenant.your_role === "admin";
  return (
    <Card aria-labelledby="workspace-heading" className="max-w-2xl">
      <CardHeader>
        <CardTitle id="workspace-heading">Workspace</CardTitle>
        <CardDescription>The name your team sees across Docent.</CardDescription>
      </CardHeader>
      <WorkspaceForm key={tenant.name} tenant={tenant} canEdit={canEdit} />
    </Card>
  );
}
