import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceForm } from "@/components/app/workspace-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { getTenant, getTimezones } from "@/lib/api/server";

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
  const [tenant, zones] = await Promise.all([getTenant(), getTimezones()]);
  const canEdit = tenant.your_role === "owner" || tenant.your_role === "admin";
  return (
    <Card aria-labelledby="workspace-heading" className="max-w-2xl">
      <CardHeader>
        <CardTitle id="workspace-heading">Workspace</CardTitle>
        <CardDescription>The name your team sees across Docent, and the time zone for daily emails.</CardDescription>
      </CardHeader>
      <WorkspaceForm key={`${tenant.name}:${tenant.timezone}`} tenant={tenant} canEdit={canEdit} zones={zones} />
    </Card>
  );
}
